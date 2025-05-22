export class ExportAction {
  query: string;
  uniqueColumn?: string;

  constructor(query: string, uniqueColumn?: string) {
    this.query = query;
    this.uniqueColumn = uniqueColumn;
  }
}