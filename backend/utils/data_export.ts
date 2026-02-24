/**
 * Data Export Utilities
 *
 * Export data in various formats (CSV, JSON, Excel)
 */

import { Response } from 'express';
import { logger } from './logger';

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export interface ExportOptions {
  filename?: string;
  format: ExportFormat;
  data: any[];
  columns?: string[];
  columnLabels?: Record<string, string>;
}

/**
 * Export data in specified format
 */
export async function exportData(res: Response, options: ExportOptions): Promise<void> {
  const filename = options.filename || `export-${Date.now()}`;

  try {
    switch (options.format) {
      case 'csv':
        exportCsv(res, options.data, filename, options.columns, options.columnLabels);
        break;
      case 'json':
        exportJson(res, options.data, filename);
        break;
      case 'xlsx':
        await exportExcel(res, options.data, filename, options.columns, options.columnLabels);
        break;
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  } catch (error: any) {
    logger.error('Failed to export data', {
      error: error.message,
      format: options.format,
      filename
    });
    throw error;
  }
}

/**
 * Export data as CSV
 */
function exportCsv(
  res: Response,
  data: any[],
  filename: string,
  columns?: string[],
  columnLabels?: Record<string, string>
): void {
  if (data.length === 0) {
    res.status(400).json({ error: 'No data to export' });
    return;
  }

  // Determine columns
  const cols = columns || Object.keys(data[0]);

  // Build CSV header
  const header = cols.map(col => columnLabels?.[col] || col).map(escapeCSV).join(',');

  // Build CSV rows
  const rows = data.map(row =>
    cols.map(col => escapeCSV(formatValue(row[col]))).join(',')
  );

  const csv = [header, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel compatibility
}

/**
 * Export data as JSON
 */
function exportJson(res: Response, data: any[], filename: string): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
  res.json(data);
}

/**
 * Export data as Excel (XLSX)
 */
async function exportExcel(
  res: Response,
  data: any[],
  filename: string,
  columns?: string[],
  columnLabels?: Record<string, string>
): Promise<void> {
  // Note: This would require the 'exceljs' library
  // For now, falling back to CSV with Excel-compatible formatting
  const ExcelJS = await import('exceljs').catch(() => null);

  if (!ExcelJS) {
    logger.warn('ExcelJS not installed, falling back to CSV export');
    exportCsv(res, data, filename, columns, columnLabels);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data');

  if (data.length === 0) {
    res.status(400).json({ error: 'No data to export' });
    return;
  }

  // Determine columns
  const cols = columns || Object.keys(data[0]);

  // Add header row
  worksheet.addRow(cols.map(col => columnLabels?.[col] || col));

  // Style header
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Add data rows
  data.forEach(row => {
    worksheet.addRow(cols.map(col => row[col]));
  });

  // Auto-fit columns
  worksheet.columns.forEach(column => {
    if (column.values) {
      const lengths = column.values.map(v => v ? v.toString().length : 0);
      const maxLength = Math.max(...lengths);
      column.width = Math.min(maxLength + 2, 50);
    }
  });

  // Write to response
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

/**
 * Escape CSV value
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format value for export
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Stream large dataset export
 */
export class DataExportStream {
  private format: ExportFormat;
  private res: Response;
  private headerWritten: boolean = false;
  private columns: string[];
  private columnLabels?: Record<string, string>;

  constructor(
    res: Response,
    format: ExportFormat,
    filename: string,
    columns: string[],
    columnLabels?: Record<string, string>
  ) {
    this.format = format;
    this.res = res;
    this.columns = columns;
    this.columnLabels = columnLabels;

    // Set headers
    switch (format) {
      case 'csv':
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        break;
      case 'json':
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        break;
      case 'xlsx':
        throw new Error('Streaming XLSX export not supported');
    }
  }

  writeHeader(): void {
    if (this.headerWritten) return;

    switch (this.format) {
      case 'csv':
        const header = this.columns
          .map(col => this.columnLabels?.[col] || col)
          .map(escapeCSV)
          .join(',');
        this.res.write('\uFEFF' + header + '\n'); // BOM for Excel
        break;
      case 'json':
        this.res.write('[');
        break;
    }

    this.headerWritten = true;
  }

  writeRow(row: any, isFirst: boolean = false): void {
    if (!this.headerWritten) {
      this.writeHeader();
    }

    switch (this.format) {
      case 'csv':
        const csvRow = this.columns
          .map(col => escapeCSV(formatValue(row[col])))
          .join(',');
        this.res.write(csvRow + '\n');
        break;
      case 'json':
        if (!isFirst) {
          this.res.write(',');
        }
        this.res.write(JSON.stringify(row));
        break;
    }
  }

  end(): void {
    switch (this.format) {
      case 'json':
        this.res.write(']');
        break;
    }

    this.res.end();
  }
}

/**
 * Create export stream for large datasets
 */
export function createExportStream(
  res: Response,
  format: ExportFormat,
  filename: string,
  columns: string[],
  columnLabels?: Record<string, string>
): DataExportStream {
  return new DataExportStream(res, format, filename, columns, columnLabels);
}

/**
 * Convert array of objects to CSV string
 */
export function arrayToCSV(
  data: any[],
  columns?: string[],
  columnLabels?: Record<string, string>
): string {
  if (data.length === 0) return '';

  const cols = columns || Object.keys(data[0]);
  const header = cols.map(col => columnLabels?.[col] || col).map(escapeCSV).join(',');
  const rows = data.map(row =>
    cols.map(col => escapeCSV(formatValue(row[col]))).join(',')
  );

  return [header, ...rows].join('\n');
}

/**
 * Parse CSV string to array of objects
 */
export function csvToArray(csv: string, hasHeader: boolean = true): any[] {
  const lines = csv.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  let headers: string[];
  let startIndex: number;

  if (hasHeader) {
    headers = parseCSVLine(lines[0]);
    startIndex = 1;
  } else {
    // Generate default headers
    const firstLine = parseCSVLine(lines[0]);
    headers = firstLine.map((_, i) => `column${i + 1}`);
    startIndex = 0;
  }

  return lines.slice(startIndex).map(line => {
    const values = parseCSVLine(line);
    const obj: any = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
  });
}

/**
 * Parse CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
