import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Columns that always render with exactly two decimals, whatever the value —
 * money reached a report somewhere and `0` would read as "not measured" where
 * `0.00` reads as "measured, and free" (offline runs really are $0.00).
 */
const COST_COLUMNS = new Set(['cost_usd']);

/**
 * RFC-4180 CSV: a single header row plus one line per row. Fields containing
 * `,`, `"`, CR or LF are quoted, embedded quotes doubled, lines joined with LF,
 * one trailing LF, no BOM. Cell rendering:
 *
 * - `null` / `undefined` → empty string
 * - numbers → plain (`0`, `210000`); cost columns render with two decimals
 * - non-finite numbers → empty string (never `NaN` or `Infinity` in a report)
 * - booleans → `true` / `false`
 * - strings → as-is (then quoted if needed)
 * - objects, arrays and dates → `JSON.stringify`
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((column) => quoteField(column)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => quoteField(renderCell(row[column], column))).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** `toCsv` with the parent directory created, written UTF-8 without a BOM. */
export function writeCsv(path: string, columns: string[], rows: Record<string, unknown>[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv(columns, rows), 'utf8');
}

function renderCell(value: unknown, column: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return COST_COLUMNS.has(column) ? value.toFixed(2) : String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
}

function quoteField(text: string): string {
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
