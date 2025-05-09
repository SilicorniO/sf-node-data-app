// src/processor/CsvProcessor.ts
export class CsvProcessor {

  static generateCSV(headers: string[], data: string[][]): string {
    // Join the headers with commas
    const headerLine = headers.join(',');

    // Map each row of data to a CSV formatted string
    const dataLines = data.map(row => {
      return row.map(value => {
        // Escape double quotes in the value
        if (typeof value === 'string') {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });

    // Combine the header and data lines into a single CSV string
    return `${headerLine}\n${dataLines.join('\n')}`;
  }

  static parseCSV(csvString: string): { headers: string[], data: string[][] } {
    // Split the CSV string into lines
    const lines = csvString.trim().split('\n');

    // Extract headers from the first line
    const headers = lines[0].split(',');

    // Extract data from the remaining lines
    const data = lines.slice(1).map(line => {
      return line.split(',').map(value => {
        // Remove surrounding quotes and unescape double quotes
        if (value.startsWith('"') && value.endsWith('"')) {
          return value.slice(1, -1).replace(/""/g, '"');
        }
        return value;
      });
    });

    return { headers, data };
  }
}
