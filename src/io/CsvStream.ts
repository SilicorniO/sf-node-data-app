import * as fs from 'fs';
import * as Papa from 'papaparse';

/**
 * Streaming CSV I/O. Rows are read and written one at a time so files larger
 * than available memory never have to be fully materialized. CSV remains the
 * source of truth and the on-disk format for the pipeline; this module only
 * changes *how* those files are read and written (row-by-row instead of
 * whole-string), preserving the same parsing/quoting behavior as CsvProcessor.
 */

/** Reads only the header row of a CSV without loading the rest of the file. */
export function readCsvHeaders(filePath: string): string[] {
  let headers: string[] = [];
  const parsed = Papa.parse<string[]>(readFirstLine(filePath), {
    header: false,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`Error parsing CSV header of "${filePath}": ${parsed.errors.map(e => e.message).join(', ')}`);
  }
  headers = parsed.data[0] ?? [];
  return [...headers];
}

/**
 * Streams a CSV file row-by-row, invoking `onRow` for each data row (the header
 * row is delivered once via `onHeaders`). Resolves when the whole file has been
 * consumed. Memory stays bounded regardless of file size.
 */
export function forEachCsvRow(
  filePath: string,
  onHeaders: (headers: string[]) => void,
  onRow: (values: string[]) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, 'utf8');
    let headersSeen = false;
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      reject(new Error(message));
    };

    Papa.parse<string[]>(stream as any, {
      header: false,
      skipEmptyLines: true,
      step: result => {
        if (settled) return;
        if (result.errors && result.errors.length > 0) {
          fail(`Error parsing CSV file "${filePath}": ${result.errors.map(e => e.message).join(', ')}`);
          return;
        }
        const values = result.data as unknown as string[];
        try {
          if (!headersSeen) {
            headersSeen = true;
            onHeaders([...values]);
            return;
          }
          onRow(values);
        } catch (error: any) {
          // A throw from a consumer callback would otherwise be swallowed by
          // PapaParse and hang the promise; surface it as a rejection.
          fail(error?.message ?? String(error));
        }
      },
      complete: () => {
        if (settled) return;
        try {
          if (!headersSeen) {
            // Empty file: surface empty headers so callers still get a schema hook.
            onHeaders([]);
          }
        } catch (error: any) {
          fail(error?.message ?? String(error));
          return;
        }
        settled = true;
        resolve();
      },
      error: (error: Error) => fail(`Error reading CSV file "${filePath}": ${error.message}`),
    });
  });
}

/**
 * A streaming CSV writer. Call `writeHeaders` once, then `writeRow` per row, then
 * `close`. Each line is serialized with PapaParse's unparse (matching
 * CsvProcessor's delimiter/newline/quoting) and flushed through a write stream so
 * the full file is never held in memory.
 */
export class CsvStreamWriter {
  private readonly stream: fs.WriteStream;
  private headersWritten = false;
  private closed = false;

  constructor(filePath: string) {
    this.stream = fs.createWriteStream(filePath, 'utf8');
  }

  writeHeaders(headers: string[]): void {
    if (this.headersWritten) {
      throw new Error('CSV headers were already written.');
    }
    this.headersWritten = true;
    this.stream.write(this.serialize(headers));
  }

  writeRow(values: string[]): void {
    if (!this.headersWritten) {
      throw new Error('CSV headers must be written before rows.');
    }
    this.stream.write(this.serialize(values));
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        resolve();
        return;
      }
      this.closed = true;
      this.stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  }

  // Serialize a single row to a CSV line + trailing newline, keeping the same
  // options as CsvProcessor.generateCSV (comma delimiter, \n newline, PapaParse's
  // automatic quoting of cells containing delimiters/quotes/newlines).
  private serialize(values: string[]): string {
    return Papa.unparse([values], { quotes: false, delimiter: ',', newline: '\n' }) + '\n';
  }
}

/** Reads the first line (up to the first newline) of a file without loading it whole. */
function readFirstLine(filePath: string): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;
    const buffer = Buffer.alloc(chunkSize);
    let content = '';
    let position = 0;
    // Accumulate chunks until a newline is found or EOF. Header rows are tiny, so
    // in practice this reads a single chunk.
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, position);
      if (bytesRead === 0) break;
      content += buffer.toString('utf8', 0, bytesRead);
      const newlineIndex = content.indexOf('\n');
      if (newlineIndex >= 0) {
        content = content.slice(0, newlineIndex);
        break;
      }
      position += bytesRead;
    }
    // Strip a trailing CR for CRLF files.
    return content.endsWith('\r') ? content.slice(0, -1) : content;
  } finally {
    fs.closeSync(fd);
  }
}
