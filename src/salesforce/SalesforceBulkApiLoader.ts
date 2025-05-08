// src/salesforce/SalesforceBulkApiLoader.ts
import * as jsforce from 'jsforce';
import { Connection } from 'jsforce';
import { DataSheet } from '../model/DataSheet';

const API_VERSION = 'v58.0'; // Define the API version constant

export class SalesforceBulkApiLoader {
  /**
   * Loads data into Salesforce using Bulk API v2, from start to finish, and modifies the DataSheet with results.
   * @param conn The Salesforce connection object.
   * @param objectName The name of the Salesforce object to load data into.
   * @param dataSheet The DataSheet object to load data from and modify with results.
   * @returns A promise that resolves to the modified DataSheet object.
   */
  static async loadDataWithBulkAPI(
    conn: Connection,
    objectName: string,
    dataSheet: DataSheet,
  ): Promise<DataSheet> {
    try {
      const timestamp = new Date().toISOString();
      const jobName = `${timestamp}_${objectName}_insert_v2`; // Operation is always insert

      // 1. Create Bulk API v2 job
      const job = await conn.request({
        method: 'POST',
        url: `/services/data/${API_VERSION}/jobs/ingest`,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          object: objectName,
          operation: 'insert', // Operation is always insert
          contentType: 'JSON',
          jobName: jobName,
        }),
      });

      const jobId = job.id;
      if (!jobId) {
        throw new Error('Failed to create Bulk API v2 job: Job ID is missing.');
      }

      // 2. Prepare and upload data
      const records = dataSheet.data.map(row => {
        const record: any = {};
        dataSheet.fieldNames.forEach((fieldName, index) => {
          record[fieldName] = row[index];
        });
        return record;
      });
      const csvData = SalesforceBulkApiLoader.toCSV(records); // Convert JSON to CSV

      // Upload data in CSV format
      await conn.request({
        method: 'PUT',
        url: `/services/data/${API_VERSION}/jobs/ingest/${jobId}/batches`,
        headers: {
          'Content-Type': 'text/csv',
          Accept: 'application/json',
          'Content-Length': csvData.length.toString(),
        },
        body: csvData,
      });

      // 3. Close the job
      await conn.request({
        method: 'PATCH',
        url: `/services/data/${API_VERSION}/jobs/ingest/${jobId}`,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ state: 'UploadComplete' }),
      });

      // 4. Wait for the job to complete
      let jobCompleted = false;
      let jobStatus: any;
      while (!jobCompleted) {
        jobStatus = await conn.request({
          method: 'GET',
          url: `/services/data/${API_VERSION}/jobs/ingest/${jobId}`,
          headers: {
            Accept: 'application/json',
          },
        });
        jobCompleted =
          jobStatus.state === 'Completed' ||
          jobStatus.state === 'Failed' ||
          jobStatus.state === 'Aborted';
        if (!jobCompleted) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      // 5. Get the job results and update the DataSheet
      const results = await SalesforceBulkApiLoader.getJobResultsV2(conn, jobId);
      dataSheet.fieldNames.push('id', 'error');
      dataSheet.apiNames.push('', '');

      // Update each row in dataSheet.data with the corresponding result
      dataSheet.data.forEach((row: string[], index: number) => {
        const successResult = results.success.find(r => r.rowId === (index + 1).toString());
        const failedResult = results.failed.find(r => r.rowId === (index + 1).toString());

        if (successResult) {
          row.push(successResult.id, '');
        } else if (failedResult) {
          row.push('', failedResult.errors.join(', '));
        } else {
          row.push('', 'Record not processed');
        }
      });
      
      return dataSheet; // Return the modified DataSheet
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 operation: ${error.message}`);
    }
  }

  /**
   * Helper function to convert JSON array to CSV format.
   * @param records Array of JSON objects.
   * @returns CSV string.
   */
  private static toCSV(records: any[]): string {
    if (!records || records.length === 0) {
      return '';
    }
    const header = Object.keys(records[0]).join(',');
    const rows = records.map(record => {
      return Object.values(record).map(value => {
        if (typeof value === 'string') {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });
    return `${header}\n${rows.join('\n')}`;
  }

  private static async getJobResultsV2(conn: Connection, jobId: string): Promise<any> {
    const successResults: any[] = [];
    const failedResults: any[] = [];
    const unprocessedResults: any[] = [];

    // Get batch IDs
    const batchesResponse: any = await conn.request({
      method: 'GET',
      url: `/services/data/${API_VERSION}/jobs/ingest/${jobId}/batches`,
      headers: {
        Accept: 'application/json',
      },
    });

    if (batchesResponse && batchesResponse.records) {
      for (const batch of batchesResponse.records) {
        // Get batch results
        if (batch.state === 'Completed' || batch.state === 'Failed') {
          const batchSuccess: any[] = await SalesforceBulkApiLoader.fetchBatchResults(conn, `/services/data/${API_VERSION}/jobs/ingest/${jobId}/batches/${batch.id}/successfulResults`);
          const batchFailed: any[] = await SalesforceBulkApiLoader.fetchBatchResults(conn, `/services/data/${API_VERSION}/jobs/ingest/${jobId}/batches/${batch.id}/failedResults`);
          const batchUnprocessed: any[] = await SalesforceBulkApiLoader.fetchBatchResults(conn, `/services/data/v58.0/jobs/ingest/${jobId}/batches/${batch.id}/unprocessedRecords`);

          successResults.push(...batchSuccess);
          failedResults.push(...batchFailed);
          unprocessedResults.push(...batchUnprocessed);
        }
      }
    }
    return { success: successResults, failed: failedResults, unprocessed: unprocessedResults };
  }

  private static async fetchBatchResults(conn: Connection, url: string): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
      const results: any[] = [];
      conn.request({
        method: 'GET',
        url: url,
        headers: {
          Accept: 'application/json',
        }
      }).then((response: any) => {
        if (Array.isArray(response)) {
          results.push(...response);
          resolve(results);
        } else if (response) {
          results.push(response);
          resolve(results)
        }
        else {
          resolve([]);
        }

      }).catch((err: any) => {
        reject(new Error(`Failed to fetch batch results from ${url}: ${err.message}`));
      });
    });
  }
}
