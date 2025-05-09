import { DataSheet } from '../model/DataSheet';
import { ObjectConf } from '../model/ObjectConf';

export class DataSheetProcessor {

  /**
   * Processes all DataSheets by applying transformations defined in their corresponding ObjectConf.
   * @param sheetsData A dictionary of all DataSheets being processed.
   * @param objectsConf An array of ObjectConf objects defining the transformations for each DataSheet.
   */
  static processAllDataSheets(
    sheetsData: { [sheetName: string]: DataSheet },
    objectsConf: ObjectConf[],
  ): { [sheetName: string]: DataSheet } {
    const transformedSheetsData: { [sheetName: string]: DataSheet } = {};

    for (const objectConf of objectsConf) {
      const sheetName = objectConf.name;
      const dataSheet = sheetsData[sheetName];
      if (dataSheet) {
        console.log(`Processing DataSheet: ${sheetName}`);
        this.processDataSheet(dataSheet, objectConf, sheetsData);
        transformedSheetsData[sheetName] = dataSheet; // Store the modified DataSheet
      } else {
        console.warn(`DataSheet "${sheetName}" not found in sheetsData. Skipping.`);
      }
    }

    return transformedSheetsData;
  }
  
  /**
   * Processes a DataSheet by applying transformations defined in the ObjectConf.
   * @param dataSheet The DataSheet to process.
   * @param objectConf The ObjectConf associated with the DataSheet.
   * @param sheetsData A dictionary of all DataSheets being processed.
   */
  static processDataSheet(
    dataSheet: DataSheet,
    objectConf: ObjectConf,
    sheetsData: { [sheetName: string]: DataSheet },
  ): void {
    // Iterate through each FieldConf in the ObjectConf
    for (const fieldConf of objectConf.fieldsConf) {
      // Check if the fieldConf has a transformation
      if (fieldConf.transformation && fieldConf.transformation.trim() !== '') {
        // Find the index of the field in the DataSheet
        const fieldIndex = dataSheet.apiNames.indexOf(fieldConf.api_name);
        if (fieldIndex === -1) {
          console.warn(`Field "${fieldConf.api_name}" not found in DataSheet "${dataSheet.name}". Skipping transformation.`);
          continue;
        }

        // Apply the transformation to each row in the DataSheet
        for (const row of dataSheet.data) {
          const originalValue = row[fieldIndex];
          const transformedValue = this.applyTransformation(originalValue, fieldConf.transformation, sheetsData);
          row[fieldIndex] = transformedValue; // Replace the value with the transformed value
        }
      }
    }
  }

  /**
   * Applies a transformation to a field value based on the transformation text and sheetsData.
   * @param value The original value of the field.
   * @param transformation The transformation text to execute.
   * @param sheetsData A dictionary of all DataSheets being processed.
   * @returns The result of the transformation as a string.
   */
  private static applyTransformation(value: string, transformation: string, sheetsData: { [sheetName: string]: DataSheet }): string {
    try {
      // Replace variables in the transformation string
      const translatedTransformation = transformation.replace(/\$\{([^}]+)\}/g, (match, variable) => {
        const [sheetName, apiName, targetColumn] = variable.split('.');
        if (!sheetName || !apiName || !targetColumn) {
          throw new Error(`Invalid variable format: ${match}`);
        }
  
        // Find the target sheet
        const targetSheet = sheetsData[sheetName];
        if (!targetSheet) {
          throw new Error(`Sheet "${sheetName}" not found in sheetsData.`);
        }
  
        // Find the index of the apiName column
        const apiNameIndex = targetSheet.apiNames.indexOf(apiName);
        if (apiNameIndex === -1) {
          throw new Error(`API name "${apiName}" not found in sheet "${sheetName}".`);
        }
  
        // Find the index of the targetColumn
        const targetColumnIndex = targetSheet.apiNames.indexOf(targetColumn);
        if (targetColumnIndex === -1) {
          throw new Error(`Target column "${targetColumn}" not found in sheet "${sheetName}".`);
        }
  
        // Find the row where the apiName column matches the value
        const targetRow = targetSheet.data.find(row => row[apiNameIndex] === value);
        if (!targetRow) {
          throw new Error(`Value "${value}" not found in column "${apiName}" of sheet "${sheetName}".`);
        }
  
        // Return the value from the target column
        return `'${targetRow[targetColumnIndex]}'`;
      });
  
      // Evaluate the translated transformation
      const result = eval(translatedTransformation); // Example: transformation could reference `sheetsData`
      return result.toString();
    } catch (error) {
      console.error(`Error applying transformation "${transformation}":`, error);
      return ''; // Return an empty string if the transformation fails
    }
  }
}