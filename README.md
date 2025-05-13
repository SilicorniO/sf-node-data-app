# SFNode Data App

SFNode Data App is a Node.js application for processing, transforming, and importing data into Salesforce using the Bulk API v2. It supports reading data from Excel and CSV files, applying transformations, and executing Salesforce import actions (insert, update, upsert, delete) as defined in a YAML configuration file.

## Features

- **Read data** from Excel (`.xlsx`) and CSV files.
- **Transform data** using configurable transformation rules.
- **Import data** into Salesforce using Bulk API v2 (insert, update, upsert, delete).
- **Rollback support**: Optionally rollback previous imports if an error occurs.
- **Flexible configuration** using YAML files.
- **Output results** as Excel and CSV files with import IDs and error messages.

## Usage

You can run the app using `ts-node` (recommended for development) or compile it and run with `node`.

### Command Line Options

- `-c, --confFile <path>`: Path to the YAML configuration file (required)
- `-e, --excelFile <path>`: Path to the Excel file (optional)
- `-v, --csvFiles <paths...>`: Paths to one or more CSV files (optional)
- `-o, --outputFolder <path>`: Output folder for result files (default: `./`)
- `-h, --includeHeaderNames`: Indicates that the Excel file has a header row with field names (default: false)

### Environment Variables

Set your Salesforce credentials in a `.env` file or as environment variables:

```
SF_CLIENT_ID=your_salesforce_client_id
SF_CLIENT_SECRET=your_salesforce_client_secret
SF_INSTANCE_URL=https://your-instance.salesforce.com
```

### Example Execution

#### 1. Import from Excel

Command:

```
node XXXX -e {EXCEL_FILE} -c {CONF_FILE} -o {OUTPUT_FOLDER}
```

Input:

input/example.xlsx: Excel file with sheets matching the action names in your config.
input/conf_import.yaml: YAML configuration file defining actions and import rules.

Output:

output/import_results.xlsx: Excel file with results, including Salesforce IDs and error messages.
output/Horario Laboral_output.csv, output/Países_output.csv: CSV files for each sheet with results.

2. Import from CSV

Command:

```
node XXXX --csvFiles {CSV_FILE} -c {CONF_FILE} -o {OUTPUT_FOLDER}
```

Input:

input/data.csv: CSV file with data.
input/conf_csv.yaml: YAML configuration file with transformation actions.
Output:

output/data_output.csv: CSV file with transformed data.

3. Multiple CSV Files

Command:

````
node XXX --csvFiles {CSV_FILE_1} {CSV_FILE_2} -c {CONF_FILE} -o {OUTPUT_FOLDER}
```

Input:

input/file1.csv, input/file2.csv: Multiple CSV files.
input/conf_import.yaml: YAML configuration file with actions for each file.
Output:

output/file1_output.csv, output/file2_output.csv: Output CSVs for each input file.
````
