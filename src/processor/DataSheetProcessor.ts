import { DataSheet } from '../model/DataSheet';
import { SheetField } from '../model/SheetField';
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
    // Prepare a list of transformations to apply, one per field
    const fieldTransformations = [];
    for (const fieldConf of transformAction.fieldsConf) {
      if (fieldConf.transformation && fieldConf.transformation.trim() !== '') {
        // get the index of the field in the DataSheet
        let fieldIndex = dataSheet.fieldNames.indexOf(fieldConf.name);

        // If the field is not found, create the field in the DataSheet
        if (fieldIndex === -1) {
          dataSheet.fieldNames.push(fieldConf.name);
          dataSheet.data.forEach(row => row.push('')); // Add empty value for new field in all rows
          fieldIndex = dataSheet.fieldNames.length - 1; // Update index to the new field
        }

        // Execute transformation
        fieldTransformations.push({
          fieldIndex,
          transformation: fieldConf.transformation,
          fieldConf,
        });
      }
    }

    if (fieldTransformations.length === 0) {
      console.log(`No transformations found for DataSheet "${dataSheet.name}".`);
      return;
    }

    // Apply transformations to each row
    console.log(`Executing transformations found for DataSheet "${dataSheet.name}".`);
    for (const row of dataSheet.data) {
      for (const { fieldIndex, transformation } of fieldTransformations) {
        const originalValue = row[fieldIndex];
        const transformedValue = DataSheetProcessor.applyTransformation(
          transformation,
          originalValue,
          sheetsData
        );
        row[fieldIndex] = transformedValue;
      }
    }
  }

  /**
   * Applies a transformation string to a value, using other sheets if needed.
   * @param transformation The transformation text to apply.
   * @param value The value to transform.
   * @param sheetsData A dictionary of all DataSheets being processed.
   * @returns The transformed value as a string.
   */
  private static applyTransformation(
    transformation: string,
    value: string,
    sheetsData: { [sheetName: string]: DataSheet }
  ): string {
    // Find all variables in the transformation string
    const variableRegex = /\$\{([^}]+)\}/g;
    let translatedTransformation = transformation;
    let match: RegExpExecArray | null;

    // Replace each variable with its looked-up value
    while ((match = variableRegex.exec(transformation)) !== null) {
      const variable = match[1];
      const [sheetName, fieldName, targetColumn] = variable.split('.');
      if (!sheetName || !fieldName || !targetColumn) {
        throw new Error(`Invalid variable format: \${${variable}}`);
      }

      const targetSheet = sheetsData[sheetName];
      if (!targetSheet) {
        throw new Error(`Sheet "${sheetName}" not found in sheetsData.`);
      }

      const apiNameIndex = targetSheet.fieldNames.indexOf(fieldName);
      const targetColumnIndex = targetSheet.fieldNames.indexOf(targetColumn);

      if (apiNameIndex === -1 || targetColumnIndex === -1) {
        throw new Error(`Invalid column references in variable: \${${variable}}`);
      }

      // Build a lookup map for the target sheet
      const lookupMap = new Map<string, string>();
      for (const row of targetSheet.data) {
        lookupMap.set(row[apiNameIndex], row[targetColumnIndex]);
      }

      const lookupValue = lookupMap.get(value);
      if (lookupValue === undefined) {
        return value; // Return the original value if not found
      }

      // Replace the variable in the transformation string with the looked-up value
      translatedTransformation = translatedTransformation.replace(
        match[0],
        `${lookupValue}`
      );
    }

    // Evaluate the translated transformation
    try {
      // eslint-disable-next-line no-eval
      return eval(translatedTransformation).toString();
    } catch (error) {
      console.error(`Error evaluating transformation "${transformation}":`, error);
      return '';
    }
  }

  /**
   * Merges two DataSheets into one, matching rows by a unique field.
   * Columns with the same name are merged, and data from the master DataSheet
   * overrides data from the secondary DataSheet for the same row and column.
   * If uniqueColumn is not found, secondary rows are appended at the end.
   * @param master The master DataSheet (takes precedence).
   * @param secondary The secondary DataSheet.
   * @param uniqueColumn The column name used to match rows.
   * @returns The merged DataSheet.
   */
  public static mergeDataSheets(
    master: DataSheet,
    secondary: DataSheet,
    uniqueColumn?: string
  ): DataSheet {
    // Merge column names (preserve order: master first, then secondary unique columns)
    const allColumns = [...master.fieldNames];
    secondary.fieldNames.forEach((col) => {
      if (!allColumns.includes(col)) {
        allColumns.push(col);
      }
    });

    // Create maps for column name to index for master and secondary
    const masterColIndexMap: { [col: string]: number } = {};
    master.fieldNames.forEach((col, idx) => {
      masterColIndexMap[col] = idx;
    });
    const secondaryColIndexMap: { [col: string]: number } = {};
    secondary.fieldNames.forEach((col, idx) => {
      secondaryColIndexMap[col] = idx;
    });

    // If uniqueColumn is not provided or not found, append secondary rows after master rows
    const masterUniqueIdx =
      uniqueColumn && masterColIndexMap[uniqueColumn] !== undefined
        ? masterColIndexMap[uniqueColumn]
        : -1;
    const secondaryUniqueIdx =
      uniqueColumn && secondaryColIndexMap[uniqueColumn] !== undefined
        ? secondaryColIndexMap[uniqueColumn]
        : -1;

    if (
      !uniqueColumn ||
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
        fieldNames: allColumns,
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

        const masterVal =
          masterColIdx !== undefined ? masterRow[masterColIdx] : '';
        let valueToSet = masterVal;

        // If master value is empty/null and secondary exists, use secondary value
        if (
          (masterVal === '' ||
            masterVal === null ||
            masterVal === undefined) &&
          secondaryRow &&
          secondaryColIdx !== undefined
        ) {
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
      fieldNames: allColumns,
      data: mergedData,
    };
  }
  
  /**
   * Translates the fieldNames of a DataSheet from name to apiName using the provided ActionField array.
   * Modifies the DataSheet in place.
   */
  public static translateFieldNamesToApiNames(dataSheet: DataSheet, sheetFields: SheetField[]): void {
    const nameToApiName: { [name: string]: string } = {};
    sheetFields.forEach(field => {
      nameToApiName[field.name] = field.apiName;
    });
    dataSheet.fieldNames = dataSheet.fieldNames.map(name => nameToApiName[name] ?? name);
  }

  /**
   * Translates the fieldNames of a DataSheet from apiName to name using the provided ActionField array.
   * Modifies the DataSheet in place.
   */
  public static translateApiNamesToFieldNames(dataSheet: DataSheet, sheetFields: SheetField[]): void {
    const apiNameToName: { [apiName: string]: string } = {};
    sheetFields.forEach(field => {
      apiNameToName[field.apiName] = field.name;
    });
    dataSheet.fieldNames = dataSheet.fieldNames.map(apiName => apiNameToName[apiName] ?? apiName);
  }

  /**
   * Creates a deep clone of a DataSheet.
   * @param dataSheet The DataSheet to clone.
   * @param newName Optional new name for the cloned DataSheet.
   * @returns A new DataSheet object with copied fieldNames and data.
   */
  public static cloneDataSheet(dataSheet: DataSheet, newName?: string): DataSheet {
    return {
      name: newName || dataSheet.name,
      fieldNames: [...dataSheet.fieldNames],
      data: dataSheet.data.map(row => [...row]),
    };
  }

}