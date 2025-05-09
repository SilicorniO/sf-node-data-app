import axios from 'axios';
import { DataSheet } from '../model/DataSheet';
import { CsvProcessor } from '../processor/CsvProcessor';
import { ObjectConf } from '../model/ObjectConf';

const API_VERSION = 'v58.0'; // Define the API version constant
const IMPORT_ID_LABEL = '_ImportId'; // Define the import ID label constant
const ERROR_MESSAGE_LABEL = '_ErrorMessage'; // Define the error message label constant
const CSV_LINE_ENDING = 'LF'; // Define the line ending for CSV files

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

  /**
   * Initializes the Axios instance with the Salesforce connection details.
   * @param instanceUrl The Salesforce instance URL.
   * @param accessToken The Salesforce access token.
   */
  static getAxiosInstance(instanceUrl: string, accessToken: string) {
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
   * @param objectConf The configuration for the Salesforce object.
   * @param dataSheet The DataSheet object to load data from and modify with results.
   * @returns A promise that resolves to the modified DataSheet object.
   */
  static async loadDataWithBulkAPI(instanceUrl: string, accessToken: string, objectConf: ObjectConf, dataSheet: DataSheet): Promise<DataSheet> {
    try {
      const axiosInstance: Axios.AxiosInstance = this.getAxiosInstance(instanceUrl, accessToken);

      // Get the index of the unique field
      const indexUniqueField = dataSheet.apiNames.findIndex(
        (apiName) => apiName === objectConf.uniqueFieldApiName,
      );
      if (indexUniqueField < 0) {
        throw new Error(
          `The object ${objectConf.name} doesn't have a valid uniqueFieldApiName: '${objectConf.uniqueFieldApiName}'`,
        );
      }

      // Generate a map of data based on the unique field
      const dataMap = new Map<string, number>();
      dataSheet.data.forEach((_row, index) => {
        dataMap.set(dataSheet.data[index][indexUniqueField], index);
      });

      // 1. Create Bulk API v2 job
      const jobResponse = await axiosInstance.post('/jobs/ingest', {
        object: objectConf.sfObject,
        operation: 'insert', // Operation is always insert
        contentType: 'CSV',
        lineEnding: CSV_LINE_ENDING,
      });

      const jobId = (jobResponse.data as JobInfo).id;
      if (!jobId) {
        throw new Error('Failed to create Bulk API v2 job: Job ID is missing.');
      }

      // 2. Prepare and upload data
      const csvData = CsvProcessor.generateCSV(dataSheet.apiNames, dataSheet.data);

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
      do {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const statusResponse = await axiosInstance.get(`/jobs/ingest/${jobId}`);
        jobStatus = statusResponse.data as JobInfo;
        jobCompleted =
          jobStatus.state === 'JobComplete' ||
          jobStatus.state === 'Failed' ||
          jobStatus.state === 'Aborted';
      } while (!jobCompleted);

      // checkif there was an error
      if(jobStatus.state === 'Failed') {
        throw new Error(`Bulk API v2 job failed for object ${objectConf.name}: ${jobStatus.errorMessage}`);
      }

      // 5. Add identifier and error message columns to the DataSheet
      const indexColumnId = dataSheet.fieldNames.length;
      dataSheet.fieldNames.push(IMPORT_ID_LABEL);
      dataSheet.apiNames.push(IMPORT_ID_LABEL);
      const indexColumnErrorMessage = dataSheet.fieldNames.length;
      dataSheet.fieldNames.push(ERROR_MESSAGE_LABEL);
      dataSheet.apiNames.push(ERROR_MESSAGE_LABEL);
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
            dataSheet.data[dataRowIndex][indexColumnErrorMessage] = row[0]; // Set ErrorMessage
          }
        });
      }

      return dataSheet; // Return the modified DataSheet
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 operation: ${error.message}`);
    }
  }
}