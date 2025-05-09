// src/salesforce/SalesforceBulkApiLoader.ts
import * as jsforce from 'jsforce';
import { Connection } from 'jsforce';
import { DataSheet } from '../model/DataSheet';
import { CsvProcessor } from '../processor/CsvProcessor'; // Import the CsvProcessor
import { ObjectConf } from '../model/ObjectConf';

const API_VERSION = 'v58.0'; // Define the API version constant

// Define interfaces for the expected responses.
// These interfaces should match the actual structure of the JSON responses from Salesforce.
interface JobInfo {
  id: string;
  state: string;
  numberRecordsProcessed: number;
  numberRecordsFailed: number;
}

interface BatchInfo {
  id: string;
  state: string;
  [key: string]: any;
}

interface JobResult {
  success: any[];
  failed: any[];
  unprocessed: any[];
}

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
    objectConf: ObjectConf,
    dataSheet: DataSheet,
  ): Promise<DataSheet> {
    try {
      // get the index of the unique field
      const indexUniqueField = dataSheet.apiNames.findIndex(apiName => apiName == objectConf.uniqueFieldApiName);
      if (indexUniqueField < 0) {
        throw new Error(`The object ${objectConf.name} hasn't got a valid uniqueFieldApiName: '${objectConf.uniqueFieldApiName}'`);
      }

      //generate a map of data based on unique field
      const dataMap = new Map<string, number>();
      dataSheet.data.forEach((_row, index) => {
        dataMap.set(dataSheet.data[index][indexUniqueField], index);
      });

      // 1. Create Bulk API v2 job
      const job: JobInfo = await conn.request({
        method: 'POST',
        url: `/services/data/${API_VERSION}/jobs/ingest`,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          object: objectConf.sfObject,
          operation: 'insert', // Operation is always insert
          contentType: 'CSV',
          lineEnding: 'CRLF'
        }),
      });

      const jobId = job.id;
      if (!jobId) {
        throw new Error('Failed to create Bulk API v2 job: Job ID is missing.');
      }

      // 2. Prepare and upload data
      const csvData = CsvProcessor.generateCSV(dataSheet.apiNames, dataSheet.data);

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
      let jobStatus: JobInfo;
      do {
        jobStatus = await conn.request({
          method: 'GET',
          url: `/services/data/${API_VERSION}/jobs/ingest/${jobId}`,
          headers: {
            Accept: 'application/json',
          },
        });
        jobCompleted =
          jobStatus.state === 'JobComplete' ||
          jobStatus.state === 'Failed' ||
          jobStatus.state === 'Aborted';
        if (!jobCompleted) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } while (!jobCompleted);

      // 5. Add identifier and errormessagecolumns to the DataSheet 
      const indexColumnId = dataSheet.fieldNames.length;
      dataSheet.fieldNames.push('sf__Id');
      const indexcolumnErrorMessage = dataSheet.fieldNames.length;
      dataSheet.fieldNames.push('ErrorMessage');
      dataSheet.apiNames.push('');
      dataSheet.apiNames.push('');
      dataSheet.data.forEach((row, index) => {
        row.push(''); // Placeholder for Id
        row.push(''); // Placeholder for ErrorMessage
      });

      // get identifiers if records were processed
      if (jobStatus.numberRecordsProcessed > 0) {
        const response: string = await conn.request({
          method: 'GET',
          url: `/services/data/${API_VERSION}/jobs/bulk/${jobId}/successfulResults`,
          headers: {
            'Accept': 'application/xml' // Specify that we want XML as the response
          }
        });
        const responseProcessed = CsvProcessor.parseCSV(response);
        // for each processed row weinclude the identifier based on the unique defined field
        responseProcessed.data.forEach((row, index) => {
          const uniqueFieldValue = row[indexUniqueField + 2]; // Adjust index to get the unique field value
          const dataRowIndex = dataMap.get(uniqueFieldValue);
          if (dataRowIndex !== undefined) {
            dataSheet.data[dataRowIndex][indexColumnId] = row[0]; // Set Id
          }
        });
      }

      // get error messages if records were failed
      if (jobStatus.numberRecordsFailed > 0) {
        const response: string = await conn.request({
          method: 'GET',
          url: `/services/data/${API_VERSION}/jobs/bulk/${jobId}/failedResults`,
          headers: {
            'Accept': 'application/xml' // Specify that we want XML as the response
          }
        });
        const responseFailed = CsvProcessor.parseCSV(response);
        // for each failed row we include the error message
        responseFailed.data.forEach((row, index) => {
          const uniqueFieldValue = row[indexUniqueField + 2]; // Adjust index to get the unique field value
          const dataRowIndex = dataMap.get(uniqueFieldValue);
          if (dataRowIndex !== undefined) {
            dataSheet.data[dataRowIndex][indexcolumnErrorMessage] = row[0]; // Set ErrorMessage
          }
        });
      }
      
      return dataSheet; // Return the modified DataSheet
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 operation: ${error.message}`);
    }
  }
}

