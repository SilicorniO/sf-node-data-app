import axios from 'axios';

import { CsvProcessor } from '../processor/CsvProcessor';
import { ImportConf } from '../model/ImportConf';
import { DataSheet } from '../model/DataSheet';
import { ImportAction } from '../model/ImportAction';

const API_VERSION = 'v58.0'; // Define the API version constant
const IMPORT_ID_LABEL = '_ImportId'; // Define the import ID label constant
const ERROR_INSERT_MESSAGE_LABEL = '_ErrorInsertMessage'; // Define the error message label constant
const ERROR_REMOVE_MESSAGE_LABEL = '_ErrorRemoveMessage'; // Define the error message label constant
const CSV_LINE_ENDING = 'LF'; // Define the line ending for CSV files
const MS_IN_SEC = 1000; // Define the milliseconds in a second constant

// Define interfaces for the expected responses.
// These interfaces should match the actual structure of the JSON responses from Salesforce.
interface JobInfo {
  id: string;
  state: string;
  numberRecordsProcessed: number;
  numberRecordsFailed: number;
  errorMessage: string;
}

export class SalesforceBulkApiLoader {
  // variables
  importConf: ImportConf; // ImportConf object

  // constructor with ImportConf
  constructor(importConf: ImportConf) {
    this.importConf = importConf;
  }

  /**
   * Initializes the Axios instance with the Salesforce connection details.
   * @param instanceUrl The Salesforce instance URL.
   * @param accessToken The Salesforce access token.
   */
  private getAxiosInstance(instanceUrl: string, accessToken: string) {
    return axios.create({
      baseURL: `${instanceUrl}/services/data/${API_VERSION}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Loads data into Salesforce using Bulk API v2 and modifies the DataSheet with results.
   * @param instanceUrl The Salesforce instance URL.
   * @param accessToken The Salesforce access token.
   * @param importAction The configuration for the Salesforce object.
   * @param dataSheet The DataSheet object to load data from and modify with results.
   * @returns Boolean indicating if there was one or more records with error.
   */
  public async insertDataWithBulkAPI(instanceUrl: string, accessToken: string, importAction: ImportAction, dataSheet: DataSheet): Promise<Boolean> {
    try {
      const axiosInstance: Axios.AxiosInstance = this.getAxiosInstance(instanceUrl, accessToken);

      // Get the index of the unique field
      const indexUniqueField = dataSheet.columnNames.findIndex(
        (apiName) => apiName === importAction.uniqueFieldName,
      );
      if (indexUniqueField < 0) {
        throw new Error(
          `The object ${importAction.importName} doesn't have a valid uniqueFieldApiName: '${importAction.uniqueFieldName}'`,
        );
      }

      // Generate a map of data based on the unique field
      const dataMap = new Map<string, number>();
      dataSheet.data.forEach((_row, index) => {
        dataMap.set(dataSheet.data[index][indexUniqueField], index);
      });

      // 1. Create Bulk API v2 job
      const jobResponse = await axiosInstance.post('/jobs/ingest', {
        object: importAction.importName,
        operation: 'insert', // Operation is always insert
        contentType: 'CSV',
        lineEnding: CSV_LINE_ENDING,
      });

      const jobId = (jobResponse.data as JobInfo).id;
      if (!jobId) {
        throw new Error('Failed to create Bulk API v2 job: Job ID is missing.');
      }

      // 2. Prepare and upload data
      const csvData = CsvProcessor.generateCSV(dataSheet.columnNames, dataSheet.data);

      // Upload data in CSV format
      await axiosInstance.put(`/jobs/ingest/${jobId}/batches`, csvData, {
        headers: {
          'Content-Type': 'text/csv',
        },
      });

      // 3. Close the job
      await axiosInstance.patch(`/jobs/ingest/${jobId}`, {
        state: 'UploadComplete',
      });

      // 4. Wait for the job to complete
      let jobCompleted = false;
      let jobStatus;
      const startTime = Date.now(); // Record the start time

      do {
        // Check if the total waiting time exceeds the maximum allowed time
        const elapsedTimeSec = (Date.now() - startTime) / MS_IN_SEC;
        if (elapsedTimeSec > this.importConf.bulkApiMaxWaitSec) {
          throw new Error(
            `Bulk API v2 job for object ${importAction.importName} exceeded the maximum wait time of ${this.importConf.bulkApiMaxWaitSec} seconds.`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, this.importConf.bulkApiPollIntervalSec * MS_IN_SEC));
        const statusResponse = await axiosInstance.get(`/jobs/ingest/${jobId}`);
        jobStatus = statusResponse.data as JobInfo;
        jobCompleted =
          jobStatus.state === 'JobComplete' ||
          jobStatus.state === 'Failed' ||
          jobStatus.state === 'Aborted';
      } while (!jobCompleted);

      // checkif there was an error
      if(jobStatus.state === 'Failed') {
        throw new Error(`Bulk API v2 job failed for object ${importAction.importName}: ${jobStatus.errorMessage}`);
      }

      // 5. Add identifier and error message columns to the DataSheet
      const indexColumnId = dataSheet.headerNames.length;
      dataSheet.headerNames.push(IMPORT_ID_LABEL);
      dataSheet.columnNames.push(IMPORT_ID_LABEL);
      const indexColumnErrorMessage = dataSheet.headerNames.length;
      dataSheet.headerNames.push(ERROR_INSERT_MESSAGE_LABEL);
      dataSheet.columnNames.push(ERROR_INSERT_MESSAGE_LABEL);
      dataSheet.data.forEach((row) => {
        row.push(''); // Placeholder for Id
        row.push(''); // Placeholder for ErrorMessage
      });

      // 6. Process successful results
      if (jobStatus.numberRecordsProcessed > 0) {
        const successfulResults = await axiosInstance.get(
          `/jobs/ingest/${jobId}/successfulResults`,
          { headers: { Accept: 'text/csv' } },
        );
        const responseProcessed = CsvProcessor.parseCSV(successfulResults.data as string);
        responseProcessed.data.forEach((row) => {
          const uniqueFieldValue = row[indexUniqueField + 2]; // Adjust index to get the unique field value
          const dataRowIndex = dataMap.get(uniqueFieldValue);
          if (dataRowIndex !== undefined) {
            dataSheet.data[dataRowIndex][indexColumnId] = row[0]; // Set Id
          }
        });
      }

      // 7. Process failed results
      if (jobStatus.numberRecordsFailed > 0) {
        const failedResults = await axiosInstance.get(
          `/jobs/ingest/${jobId}/failedResults`,
          { headers: { Accept: 'text/csv' } },
        );
        const responseFailed = CsvProcessor.parseCSV(failedResults.data as string);
        responseFailed.data.forEach((row) => {
          const uniqueFieldValue = row[indexUniqueField + 2]; // Adjust index to get the unique field value
          const dataRowIndex = dataMap.get(uniqueFieldValue);
          if (dataRowIndex !== undefined) {
            dataSheet.data[dataRowIndex][indexColumnErrorMessage] = row[1]; // Set ErrorMessage
          }
        });
      }

      return jobStatus.numberRecordsFailed == 0; // Return the modified DataSheet
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 operation: ${error.message}`);
    }
  }

  /**
   * Deletes records in Salesforce using Bulk API v2 based on the idFieldName in ImportAction.
   * @param instanceUrl The Salesforce instance URL.
   * @param accessToken The Salesforce access token.
   * @param importAction The ImportAction configuration (must have idFieldName).
   * @param dataSheet The DataSheet containing the records to delete (idFieldName column must be filled).
   * @returns A promise that resolves to the modified DataSheet object.
   */
  public async deleteDataWithBulkAPI(
    instanceUrl: string,
    accessToken: string,
    importAction: ImportAction,
    dataSheet: DataSheet
  ): Promise<Boolean> {
    try {
      const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);

      // Find the index of the id field
      const indexIdField = dataSheet.columnNames.findIndex(
        (apiName) => apiName === importAction.idFieldName
      );
      if (indexIdField < 0) {
        throw new Error(
          `The object ${importAction.importName} doesn't have a valid idFieldName: '${importAction.idFieldName}'`
        );
      }

      // Generate a map of data based on the unique field
      const dataMap = new Map<string, number>();
      dataSheet.data.forEach((_row, index) => {
        dataMap.set(dataSheet.data[index][indexIdField], index);
      });

      // Prepare only the Id column for deletion
      const deleteHeaders = ["Id"];
      const deleteData = dataSheet.data
        .map(row => [row[indexIdField]])
        .filter(idArr => idArr[0]); // Only rows with an Id

      if (deleteData.length === 0) {
        console.log('No records with Id found to delete.');
        return true; // returnOK
      }

      // 1. Create Bulk API v2 job for delete
      const jobResponse = await axiosInstance.post('/jobs/ingest', {
        object: importAction.importName,
        operation: 'delete',
        contentType: 'CSV',
        lineEnding: CSV_LINE_ENDING,
      });

      const jobId = (jobResponse.data as JobInfo).id;
      if (!jobId) {
        throw new Error('Failed to create Bulk API v2 job: Job ID is missing.');
      }

      // 2. Prepare and upload data
      const csvData = CsvProcessor.generateCSV(deleteHeaders, deleteData);

      await axiosInstance.put(`/jobs/ingest/${jobId}/batches`, csvData, {
        headers: {
          'Content-Type': 'text/csv',
        },
      });

      // 3. Close the job
      await axiosInstance.patch(`/jobs/ingest/${jobId}`, {
        state: 'UploadComplete',
      });

      // 4. Wait for the job to complete
      let jobCompleted = false;
      let jobStatus;
      const startTime = Date.now();

      do {
        const elapsedTimeSec = (Date.now() - startTime) / MS_IN_SEC;
        if (elapsedTimeSec > this.importConf.bulkApiMaxWaitSec) {
          throw new Error(
            `Bulk API v2 delete job for object ${importAction.importName} exceeded the maximum wait time of ${this.importConf.bulkApiMaxWaitSec} seconds.`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, this.importConf.bulkApiPollIntervalSec * MS_IN_SEC));
        const statusResponse = await axiosInstance.get(`/jobs/ingest/${jobId}`);
        jobStatus = statusResponse.data as JobInfo;
        jobCompleted =
          jobStatus.state === 'JobComplete' ||
          jobStatus.state === 'Failed' ||
          jobStatus.state === 'Aborted';
      } while (!jobCompleted);

      if (jobStatus.state === 'Failed') {
        throw new Error(`Bulk API v2 delete job failed for object ${importAction.importName}: ${jobStatus.errorMessage}`);
      }

      // 5. Add identifier and error message columns to the DataSheet
      const indexColumnErrorRemoveMessage = dataSheet.headerNames.length;
      dataSheet.headerNames.push(ERROR_REMOVE_MESSAGE_LABEL);
      dataSheet.columnNames.push(ERROR_REMOVE_MESSAGE_LABEL);

      // 7. Process failed results
      if (jobStatus.numberRecordsFailed > 0) {
        const failedResults = await axiosInstance.get(
          `/jobs/ingest/${jobId}/failedResults`,
          { headers: { Accept: 'text/csv' } },
        );
        const responseFailed = CsvProcessor.parseCSV(failedResults.data as string);
        responseFailed.data.forEach((row) => {
          const idFieldValue = row[0]; // The Id is in the first column of the failed results
          const dataRowIndex = dataMap.get(idFieldValue);
          if (dataRowIndex !== undefined) {
            dataSheet.data[dataRowIndex][indexColumnErrorRemoveMessage] = row[1]; // The error message is in the second column
          }
        });
      }

      return jobStatus.numberRecordsFailed == 0;
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 delete operation: ${error.message}`);
    }
  }
}