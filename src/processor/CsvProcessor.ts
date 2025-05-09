import * as Papa from 'papaparse';

export class CsvProcessor {
  /**
   * Generates a CSV string from headers and data using PapaParse.
   * @param headers The headers for the CSV file.
   * @param data The data rows for the CSV file.
   * @returns A CSV string.
   */
  static generateCSV(headers: string[], data: string[][]): string {
    // Combine headers and data into a single array
    const csvData = [headers, ...data];

    // Use PapaParse to generate the CSV string
    return Papa.unparse(csvData, {
      quotes: false, // Always quote fields
      delimiter: ',', // Use comma as the delimiter
      newline: '\n', // Use newline as the line ending
    });
  }

  /**
   * Parses a CSV string into headers and data using PapaParse.
   * @param csvString The CSV string to parse.
   * @returns An object containing headers and data.
   */
  static parseCSV(csvString: string): { headers: string[]; data: string[][] } {
    // Use PapaParse to parse the CSV string
    const result = Papa.parse<string[]>(csvString, {
      header: false, // Do not treat the first row as headers
      skipEmptyLines: true, // Skip empty lines
    });

    if (result.errors.length > 0) {
      throw new Error(`Error parsing CSV: ${result.errors.map(e => e.message).join(', ')}`);
    }

    // Extract headers and data
    const [headers, ...data] = result.data;

    return { headers, data };
  }
}