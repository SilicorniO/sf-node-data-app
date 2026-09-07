import { DataSheet } from '../model/DataSheet';
import { SheetField } from '../model/SheetField';

export interface FieldTranslationResult {
  translated: string[];
  missing: string[];
}

export class DataSheetProcessor {
  static translateFieldNamesToApiNames(
    dataSheet: DataSheet,
    sheetFields: SheetField[]
  ): FieldTranslationResult {
    const sourceFields = new Set(dataSheet.fieldNames);
    const mappings = new Map(sheetFields.map(field => [field.name, field.apiName]));
    dataSheet.fieldNames = dataSheet.fieldNames.map(name => mappings.get(name) ?? name);
    return {
      translated: sheetFields.filter(field => sourceFields.has(field.name)).map(field => field.name),
      missing: sheetFields.filter(field => !sourceFields.has(field.name)).map(field => field.name),
    };
  }

  static cloneDataSheet(dataSheet: DataSheet, newName?: string): DataSheet {
    return {
      name: newName || dataSheet.name,
      fieldNames: [...dataSheet.fieldNames],
      data: dataSheet.data.map(row => [...row]),
    };
  }
}
