export class ExportAction {
  query: string;
  uniqueField?: string;

  constructor(query: string, uniqueField?: string) {
    this.query = query;
    this.uniqueField = uniqueField;
  }
}