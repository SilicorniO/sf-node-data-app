import axios from 'axios';
import { AppConfiguration } from '../model/AppConfiguration';
import { DataSheet } from '../model/DataSheet';
import { CsvProcessor } from '../processor/CsvProcessor';
import {
  deriveSoqlHeaders,
  formatElapsed,
  logSalesforceStatus,
  SalesforceDataLoader,
  SalesforceWriteRequest,
  withStatusHeartbeat,
  WriteRowResult,
} from './SalesforceOperation';

const CSV_LINE_ENDING = 'LF';
const MS_IN_SEC = 1000;
const BULK_QUERY_RESULT_PAGE_SIZE = 50_000;

interface JobInfo {
  id: string;
  state: string;
  numberRecordsProcessed: number;
  numberRecordsFailed: number;
  errorMessage?: string;
}

export class SalesforceBulkApiLoader implements SalesforceDataLoader {
  constructor(private readonly appConfiguration: AppConfiguration) {}

  async query(instanceUrl: string, accessToken: string, query: string, outputName: string): Promise<DataSheet> {
    const client = this.getAxiosInstance(instanceUrl, accessToken);
    try {
      logSalesforceStatus('        Query: creating Bulk API v2 query job.');
      const created = await client.post('/jobs/query', {
        operation: 'query',
        query,
        contentType: 'CSV',
        lineEnding: CSV_LINE_ENDING,
      });
      const jobId = created.data?.id;
      if (!jobId) throw new Error('Salesforce did not return a query job ID.');
      const status = await this.waitForJob(client, `/jobs/query/${jobId}`, 'query');
      if (status.state !== 'JobComplete') {
        throw new Error(status.errorMessage || `Query job ended in state ${status.state}.`);
      }
      return await this.readQueryResults(client, jobId, query, outputName);
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 GET: ${this.readBulkApiErrors(error)}`);
    }
  }

  async write(
    instanceUrl: string,
    accessToken: string,
    request: SalesforceWriteRequest
  ): Promise<WriteRowResult[]> {
    if (request.rows.length === 0) return [];
    const client = this.getAxiosInstance(instanceUrl, accessToken);
    try {
      const jobRequest: Record<string, unknown> = {
        object: request.object,
        operation: request.operation,
        contentType: 'CSV',
        lineEnding: CSV_LINE_ENDING,
      };
      if (request.operation === 'upsert') {
        jobRequest.externalIdFieldName = request.externalIdField;
      }
      const created = await client.post('/jobs/ingest', jobRequest);
      const jobId = created.data?.id;
      if (!jobId) throw new Error('Salesforce did not return an ingest job ID.');

      const payload = CsvProcessor.generateCSV(
        request.fields,
        request.rows.map(row => request.fields.map(field => row.values[field] ?? ''))
      );
      await client.put(`/jobs/ingest/${jobId}/batches`, payload, {
        headers: { 'Content-Type': 'text/csv' },
      });
      await client.patch(`/jobs/ingest/${jobId}`, { state: 'UploadComplete' });
      const status = await this.waitForJob(client, `/jobs/ingest/${jobId}`, `${request.operation} ${request.object}`);
      if (status.state !== 'JobComplete') {
        throw new Error(status.errorMessage || `Ingest job ended in state ${status.state}.`);
      }
      return await this.readWriteResults(client, jobId, request, status);
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 ${request.operation}: ${this.readBulkApiErrors(error)}`);
    }
  }

  private async readWriteResults(
    client: any,
    jobId: string,
    request: SalesforceWriteRequest,
    status: JobInfo
  ): Promise<WriteRowResult[]> {
    const unmatched = new Set(request.rows.map(row => row.inputIndex));
    const queues = new Map<string, number[]>();
    for (const row of request.rows) {
      const fingerprint = this.fingerprint(request.fields, row.values);
      queues.set(fingerprint, [...(queues.get(fingerprint) ?? []), row.inputIndex]);
    }
    const takeIndex = (record: Record<string, string>): number => {
      const fingerprint = this.fingerprint(request.fields, record);
      const queue = queues.get(fingerprint);
      const matched = queue?.shift();
      const fallback = unmatched.values().next().value as number | undefined;
      const index = matched ?? fallback;
      if (index === undefined) throw new Error('Could not correlate a Salesforce result to an input row.');
      unmatched.delete(index);
      return index;
    };

    const results: WriteRowResult[] = [];
    if (status.numberRecordsProcessed > 0) {
      const response = await client.get(`/jobs/ingest/${jobId}/successfulResults`, {
        headers: { Accept: 'text/csv' },
      });
      const parsed = CsvProcessor.parseCSV(String(response.data));
      for (const values of parsed.data) {
        const record = this.record(parsed.headers, values);
        results.push({
          inputIndex: takeIndex(record),
          success: true,
          id: record.sf__Id || record.Id || undefined,
        });
      }
    }
    if (status.numberRecordsFailed > 0) {
      const response = await client.get(`/jobs/ingest/${jobId}/failedResults`, {
        headers: { Accept: 'text/csv' },
      });
      const parsed = CsvProcessor.parseCSV(String(response.data));
      for (const values of parsed.data) {
        const record = this.record(parsed.headers, values);
        results.push({
          inputIndex: takeIndex(record),
          success: false,
          error: record.sf__Error || 'Unknown Salesforce row error',
        });
      }
    }
    return results.sort((left, right) => left.inputIndex - right.inputIndex);
  }

  private async readQueryResults(
    client: any,
    jobId: string,
    query: string,
    outputName: string
  ): Promise<DataSheet> {
    let locator = '';
    let page = 0;
    let fieldNames: string[] = [];
    const allRows: string[][] = [];
    const started = Date.now();

    do {
      page++;
      const params: Record<string, string | number> = { maxRecords: BULK_QUERY_RESULT_PAGE_SIZE };
      if (locator) params.locator = locator;
      logSalesforceStatus(
        `        Query: downloading results page ${page} (up to ${BULK_QUERY_RESULT_PAGE_SIZE} row(s)).`
      );
      const response: any = await withStatusHeartbeat(
        client.get(`/jobs/query/${jobId}/results`, {
          headers: { Accept: 'text/csv' },
          params,
        }),
        elapsedMs => {
          logSalesforceStatus(
            `        Query: still waiting for results page ${page} `
            + `(${allRows.length} row(s) so far, ${formatElapsed(elapsedMs)} elapsed).`
          );
        }
      );
      const csv = String(response.data ?? '');
      if (csv.trim()) {
        const parsed = CsvProcessor.parseCSV(csv);
        if (fieldNames.length === 0 && parsed.headers?.length) {
          fieldNames = parsed.headers;
        }
        if (parsed.data?.length) {
          allRows.push(...parsed.data);
        }
      }
      locator = readLocator(response.headers);
      logSalesforceStatus(
        `        Query: results page ${page} downloaded `
        + `${allRows.length} row(s) total${locator ? '.' : `, complete in ${formatElapsed(Date.now() - started)}.`}`
      );
    } while (locator);

    if (fieldNames.length === 0) {
      fieldNames = deriveSoqlHeaders(query);
    }
    return { name: outputName, fieldNames, data: allRows };
  }

  private async waitForJob(client: any, statusUrl: string, description: string): Promise<JobInfo> {
    const maxWaitSeconds = this.appConfiguration.bulkApiMaxWaitSec ?? 300;
    const pollSeconds = this.appConfiguration.bulkApiPollIntervalSec ?? 5;
    const started = Date.now();
    while (true) {
      const response = await client.get(statusUrl);
      const status = response.data as JobInfo;
      const jobId = status.id ? ` ${status.id}` : '';
      logSalesforceStatus(
        `        ${description} job${jobId}: ${status.state} `
        + `(${status.numberRecordsProcessed ?? 0} processed, ${status.numberRecordsFailed ?? 0} failed).`
      );
      if (['JobComplete', 'Failed', 'Aborted'].includes(status.state)) return status;
      if ((Date.now() - started) / MS_IN_SEC > maxWaitSeconds) {
        throw new Error(`${description} job exceeded the maximum wait time of ${maxWaitSeconds} seconds.`);
      }
      await new Promise(resolve => setTimeout(resolve, pollSeconds * MS_IN_SEC));
    }
  }

  private getAxiosInstance(instanceUrl: string, accessToken: string): any {
    return axios.create({
      baseURL: `${instanceUrl}/services/data/v${this.appConfiguration.apiVersion}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private fingerprint(fields: string[], values: Record<string, string>): string {
    return JSON.stringify(fields.map(field => values[field] ?? ''));
  }

  private record(headers: string[], values: string[]): Record<string, string> {
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  }

  private readBulkApiErrors(error: any): string {
    if (error?.response?.data && Array.isArray(error.response.data)) {
      return error.response.data
        .map((item: any) => `[${item.errorCode}] ${item.message}`)
        .join(' | ');
    }
    return error?.message || 'Unknown error';
  }
}

function readLocator(headers: any): string {
  if (!headers) return '';
  const raw = typeof headers.get === 'function'
    ? headers.get('sforce-locator') ?? headers.get('Sforce-Locator')
    : headers['sforce-locator'] ?? headers['Sforce-Locator'];
  if (raw == null) return '';
  const value = String(raw).trim();
  if (!value || value.toLowerCase() === 'null') return '';
  return value;
}
