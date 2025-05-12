// src/models/DataSheet.ts

export interface DataSheet {
  name: string;
  headerNames: string[];
  columnNames: string[];
  data: string[][];
}
