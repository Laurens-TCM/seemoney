// Frollo CSV text → rows keyed by header. Parsing happens on the device; nothing is uploaded.
import Papa from 'papaparse';
import { missingColumns, type FrolloRow } from './classify';

export interface ParsedCsv { rows: FrolloRow[]; missing: string[] }

export function parseFrolloCsv(text: string): ParsedCsv {
  // Normalise line endings first: PapaParse picks one style from the first line, so a file with
  // mixed endings would otherwise merge rows.
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const res = Papa.parse<FrolloRow>(clean, { header: true, skipEmptyLines: true });
  return { rows: res.data, missing: missingColumns(res.meta.fields ?? []) };
}
