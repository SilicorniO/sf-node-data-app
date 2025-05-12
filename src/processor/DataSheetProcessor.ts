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
        fieldIndex: dataSheet.apiNames.indexOf(fieldConf.fieldName),
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

      const apiNameIndex = targetSheet.apiNames.indexOf(apiName);
      const targetColumnIndex = targetSheet.apiNames.indexOf(targetColumn);

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
}