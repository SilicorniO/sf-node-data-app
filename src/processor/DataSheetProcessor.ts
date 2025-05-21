import { DataSheet } from '../model/DataSheet';
import { TransformAction } from '../model/TransformAction';

export class DataSheetProcessor {
  
  /**
   * Processes a DataSheet by applying transformations defined in the ObjectConf.
   * @param dataSheet The DataSheet to process.
   * @param transformAction The transformation action to apply.
   * @param sheetsData A dictionary of all DataSheets being processed.
   */
  static processDataSheet(
    dataSheet: DataSheet,
    transformAction: TransformAction,
    sheetsData: { [sheetName: string]: DataSheet },
  ): void {
    // Precompute indices and transformations for better performance
    const fieldTransformations = transformAction.fieldsConf
      .filter((fieldConf) => fieldConf.transformation && fieldConf.transformation.trim() !== '')
      .map((fieldConf) => ({
        fieldIndex: dataSheet.columnNames.indexOf(fieldConf.fieldName),
        transformation: this.compileTransformation(fieldConf.transformation, sheetsData),
        fieldConf,
      }))
      .filter(({ fieldIndex }) => fieldIndex !== -1);

    if (fieldTransformations.length === 0) {
      console.log(`No transformations found for DataSheet "${dataSheet.name}".`);
      return;
    }

    // Apply transformations to each row
    console.log(`Executing transformations found for DataSheet "${dataSheet.name}".`);
    for (const row of dataSheet.data) {
      for (const { fieldIndex, transformation, fieldConf } of fieldTransformations) {
        const originalValue = row[fieldIndex];
        const transformedValue = transformation(originalValue);
        row[fieldIndex] = transformedValue; // Replace the value with the transformed value
      }
    }
  }

  /**
   * Compiles a transformation into a reusable function for better performance.
   * @param transformation The transformation text to compile.
   * @param sheetsData A dictionary of all DataSheets being processed.
   * @returns A function that applies the transformation to a given value.
   */
  private static compileTransformation(
    transformation: string,
    sheetsData: { [sheetName: string]: DataSheet },
  ): (value: string) => string {
    // Precompute indices for target sheets and columns
    const variableRegex = /\$\{([^}]+)\}/g;
    const variableMappings: { [variable: string]: (value: string) => string } = {};

    transformation.replace(variableRegex, (match, variable) => {
      const [sheetName, apiName, targetColumn] = variable.split('.');
      if (!sheetName || !apiName || !targetColumn) {
        throw new Error(`Invalid variable format: ${match}`);
      }

      const targetSheet = sheetsData[sheetName];
      if (!targetSheet) {
        throw new Error(`Sheet "${sheetName}" not found in sheetsData.`);
      }

      const apiNameIndex = targetSheet.columnNames.indexOf(apiName);
      const targetColumnIndex = targetSheet.columnNames.indexOf(targetColumn);

      if (apiNameIndex === -1 || targetColumnIndex === -1) {
        throw new Error(`Invalid column references in variable: ${match}`);
      }

      // Build an index for fast lookups
      const lookupMap = new Map<string, string>();
      for (const row of targetSheet.data) {
        lookupMap.set(row[apiNameIndex], row[targetColumnIndex]);
      }

      // Store the lookup function
      variableMappings[match] = (value: string) => {
        const result = lookupMap.get(value);
        if (result === undefined) {
          throw new Error(`Value "${value}" not found for variable "${match}".`);
        }
        return result;
      };

      return match;
    });

    // Return a compiled function that applies the transformation
    return (value: string) => {
      let translatedTransformation = transformation;
      for (const [variable, lookupFn] of Object.entries(variableMappings)) {
        translatedTransformation = translatedTransformation.replace(variable, `'${lookupFn(value)}'`);
      }

      // Evaluate the translated transformation
      try {
        return eval(translatedTransformation).toString();
      } catch (error) {
        console.error(`Error evaluating transformation "${transformation}":`, error);
        return ''; // Return an empty string if the transformation fails
      }
    };
  }

  /**
   * Merges two DataSheets into one, matching rows by a unique field.
   * Columns with the same name are merged, and data from the master DataSheet
   * overrides data from the secondary DataSheet for the same row and column.
   * If uniqueFieldName is not found, secondary rows are appended at the end.
   * @param master The master DataSheet (takes precedence).
   * @param secondary The secondary DataSheet.
   * @param uniqueFieldName The column name used to match rows.
   * @returns The merged DataSheet.
   */
  public static mergeDataSheets(
    master: DataSheet,
    secondary: DataSheet,
    uniqueFieldName?: string
  ): DataSheet {
    // Merge column names (preserve order: master first, then secondary unique columns)
    const allColumns = [...master.columnNames];
    const allHeaders = [...master.headerNames];
    secondary.columnNames.forEach((col, index) => {
      const allColumnsIndex = allColumns.indexOf(col);
      if (allColumnsIndex === -1) {
        allColumns.push(col);
        allHeaders.push(secondary.headerNames[index]);
      } else if ((allHeaders[allColumnsIndex] === '' || allHeaders[allColumnsIndex] === allColumns[allColumnsIndex]) && secondary.headerNames[index] !=='' ) {
        allHeaders[allColumnsIndex] = secondary.headerNames[index];
      }
    });

    // Create maps for column name to index for master and secondary
    const masterColIndexMap: { [col: string]: number } = {};
    master.columnNames.forEach((col, idx) => {
      masterColIndexMap[col] = idx;
    });
    const secondaryColIndexMap: { [col: string]: number } = {};
    secondary.columnNames.forEach((col, idx) => {
      secondaryColIndexMap[col] = idx;
    });

    // If uniqueFieldName is not provided or not found, append secondary rows after master rows
    const masterUniqueIdx = uniqueFieldName ? masterColIndexMap[uniqueFieldName] ?? -1 : -1;
    const secondaryUniqueIdx = uniqueFieldName ? secondaryColIndexMap[uniqueFieldName] ?? -1 : -1;

    if (
      !uniqueFieldName ||
      masterUniqueIdx === -1 ||
      secondaryUniqueIdx === -1
    ) {
      // Fallback: append all secondary rows after master rows
      const mergedData = [...master.data];
      for (const row of secondary.data) {
        mergedData.push(
          allColumns.map((col) => {
            const secIdx = secondaryColIndexMap[col];
            return secIdx !== undefined ? row[secIdx] : '';
          })
        );
      }
      return {
        name: master.name,
        headerNames: allHeaders,
        columnNames: allColumns,
        data: mergedData,
      };
    }

    // Build maps for fast lookup by unique field value
    const masterMap = new Map<string, string[]>();
    for (const row of master.data) {
      const key = row[masterUniqueIdx];
      if (key) masterMap.set(key, row);
    }
    const secondaryMap = new Map<string, string[]>();
    for (const row of secondary.data) {
      const key = row[secondaryUniqueIdx];
      if (key) secondaryMap.set(key, row);
    }

    const mergedData: string[][] = [];

    // Merge rows by unique key (master rows first)
    for (const [key, masterRow] of masterMap.entries()) {
      const mergedRow: string[] = [];
      const secondaryRow = secondaryMap.get(key);
      for (const col of allColumns) {
        const masterColIdx = masterColIndexMap[col];
        const secondaryColIdx = secondaryColIndexMap[col];

        const masterVal = masterColIdx !== undefined ? masterRow[masterColIdx] : '';
        let valueToSet = masterVal;

        // If master value is empty/null and secondary exists, use secondary value
        if ((masterVal === '' || masterVal === null || masterVal === undefined) && secondaryRow && secondaryColIdx !== undefined) {
          const secondaryVal = secondaryRow[secondaryColIdx];
          valueToSet = secondaryVal;
        }

        mergedRow.push(valueToSet);
      }
      mergedData.push(mergedRow);
      // Remove from secondaryMap so we can later add only unmatched secondary rows
      if (secondaryRow) secondaryMap.delete(key);
    }

    // Add remaining secondary rows that were not in master
    for (const [, secondaryRow] of secondaryMap.entries()) {
      const row: string[] = [];
      for (const col of allColumns) {
        const idx = secondaryColIndexMap[col];
        row.push(idx !== undefined ? secondaryRow[idx] : '');
      }
      mergedData.push(row);
    }

    return {
      name: master.name,
      headerNames: allHeaders,
      columnNames: allColumns,
      data: mergedData,
    };
  }
}