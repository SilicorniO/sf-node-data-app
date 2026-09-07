import axios from 'axios';
import { AppConfiguration } from '../model/AppConfiguration';
import { DataSheet } from '../model/DataSheet';
import {
  deriveSoqlHeaders,
  formatElapsed,
  logSalesforceStatus,
  SalesforceDataLoader,
  SalesforceWriteRequest,
  withStatusHeartbeat,
  WriteRowResult,
} from './SalesforceOperation';

const MAX_COLLECTION_BATCH_SIZE = 200;

export class SalesforceApiLoader implements SalesforceDataLoader {
  constructor(private readonly appConfiguration: AppConfiguration) {}

  async query(instanceUrl: string, accessToken: string, query: string, outputName: string): Promise<DataSheet> {
    const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);
    let url = `/query?q=${encodeURIComponent(query)}`;
    const allRecords: Record<string, unknown>[] = [];
    let fieldNames: string[] = [];
    let page = 0;
    const started = Date.now();
    const batchSize = this.appConfiguration.queryApiBatchSize;
    logSalesforceStatus(
      `        Query: requesting page 1 from the synchronous Query API (batchSize ${batchSize}).`
    );

    while (url) {
      page++;
      try {
        const response = await withStatusHeartbeat(
          axiosInstance.get(url, {
            headers: { 'Sforce-Query-Options': `batchSize=${batchSize}` },
          }),
          elapsedMs => {
            logSalesforceStatus(
              `        Query: still waiting for page ${page} `
              + `(${allRecords.length} row(s) so far, ${formatElapsed(elapsedMs)} elapsed).`
            );
          }
        );
        const data: any = response.data;
        const records = Array.isArray(data.records)
          ? data.records.map((record: Record<string, unknown>) => {
              const { attributes: _attributes, ...values } = record;
              return values;
            })
          : [];
        if (fieldNames.length === 0 && records.length > 0) {
          fieldNames = Object.keys(records[0]);
        }
        allRecords.push(...records);
        url = data.nextRecordsUrl
          ? data.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+\//, '/')
          : '';
        const total = typeof data.totalSize === 'number' ? ` of ${data.totalSize}` : '';
        logSalesforceStatus(
          `        Query: page ${page} returned ${records.length} row(s) `
          + `(${allRecords.length}${total} total)`
          + `${url ? '.' : `, complete in ${formatElapsed(Date.now() - started)}.`}`
        );
        if (url && records.length > 0 && records.length < batchSize) {
          logSalesforceStatus(
            `        Query: Salesforce reduced the page below requested batchSize ${batchSize}.`
          );
        }
      } catch (error: any) {
        throw new Error(`Error during Query API GET: ${this.readApiErrors(error)}`);
      }
    }

    if (fieldNames.length === 0) {
      fieldNames = deriveSoqlHeaders(query);
    }
    return {
      name: outputName,
      fieldNames,
      data: allRecords.map(record => fieldNames.map(field => this.stringify(record[field]))),
    };
  }

  async write(
    instanceUrl: string,
    accessToken: string,
    request: SalesforceWriteRequest
  ): Promise<WriteRowResult[]> {
    const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);
    const results: WriteRowResult[] = [];

    const batchCount = Math.ceil(request.rows.length / MAX_COLLECTION_BATCH_SIZE);
    if (request.rows.length > 0) {
      logSalesforceStatus(
        `        Write: submitting ${request.rows.length} row(s) in ${batchCount} `
        + `batch(es) of up to ${MAX_COLLECTION_BATCH_SIZE}.`
      );
    }

    for (let offset = 0; offset < request.rows.length; offset += MAX_COLLECTION_BATCH_SIZE) {
      const rows = request.rows.slice(offset, offset + MAX_COLLECTION_BATCH_SIZE);
      const batchNumber = Math.floor(offset / MAX_COLLECTION_BATCH_SIZE) + 1;
      const records = rows.map(row => ({
        ...row.values,
        attributes: { type: request.object },
      }));

      let url = '/composite/sobjects';
      let method: 'POST' | 'PATCH' | 'DELETE';
      let data: unknown;
      if (request.operation === 'insert') {
        method = 'POST';
        data = { allOrNone: false, records };
      } else if (request.operation === 'update') {
        method = 'PATCH';
        data = { allOrNone: false, records };
      } else if (request.operation === 'upsert') {
        method = 'PATCH';
        url = `/composite/sobjects/${request.object}/${request.externalIdField}`;
        data = { allOrNone: false, records };
      } else {
        method = 'DELETE';
        const ids = rows.map(row => row.values.Id).join(',');
        url = `/composite/sobjects?ids=${encodeURIComponent(ids)}&allOrNone=false`;
      }

      try {
        logSalesforceStatus(
          `        Write: batch ${batchNumber}/${batchCount} `
          + `(rows ${offset + 1}–${offset + rows.length} of ${request.rows.length}).`
        );
        const response = await withStatusHeartbeat(axiosInstance.request({ url, method, data }), elapsedMs => {
          logSalesforceStatus(
            `        Write: still waiting for batch ${batchNumber}/${batchCount} `
            + `(${formatElapsed(elapsedMs)} elapsed).`
          );
        });
        const responseData: any = response.data;
        const responseRows = Array.isArray(responseData) ? responseData : responseData?.results;
        if (!Array.isArray(responseRows)) {
          throw new Error('Salesforce returned an unexpected write response.');
        }
        responseRows.forEach((result: any, index: number) => {
          results.push({
            inputIndex: rows[index].inputIndex,
            success: Boolean(result.success),
            id: result.id ? String(result.id) : undefined,
            error: result.success ? undefined : this.resultErrors(result.errors),
          });
        });
      } catch (error: any) {
        throw new Error(`Error during sObject Collections API ${request.operation}: ${this.readApiErrors(error)}`);
      }
    }
    return results;
  }

  private getAxiosInstance(instanceUrl: string, accessToken: string) {
    return axios.create({
      baseURL: `${instanceUrl}/services/data/v${this.appConfiguration.apiVersion}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private resultErrors(errors: any): string {
    if (!Array.isArray(errors)) return 'Unknown Salesforce row error';
    return errors.map(error => error.message ?? String(error)).join(' | ');
  }

  private stringify(value: unknown): string {
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  private readApiErrors(error: any): string {
    if (error?.response?.data && Array.isArray(error.response.data)) {
      return error.response.data
        .map((item: any) => `[${item.errorCode}] ${item.message}`)
        .join(' | ');
    }
    if (error?.response?.data?.error && error.response.data.error_description) {
      return `[${error.response.data.error}] ${error.response.data.error_description}`;
    }
    return error?.message || 'Unknown error';
  }
}
