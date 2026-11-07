/*
 * A small CSV reader for the opening-balance import (pure, no I/O). RFC 4180 with the usual spreadsheet export
 * quirks: a UTF-8 BOM is dropped; records end at CRLF, LF or CR; fields may be "quoted" (a quote inside is written
 * twice, and a quoted field may hold the delimiter or a line break); the delimiter is a comma, or a semicolon when the
 * header line has semicolons and no commas (spreadsheets in comma-decimal locales export that). Blank records (every
 * field empty, e.g. trailing empty lines or a row of separators) are skipped but still counted, so a data row's
 * number is its position after the header, as the spreadsheet shows it (row 1 = the first line after the header).
 */

export type CsvRecord = { row: number; cells: string[] }
export type CsvError = { row: number; message: string }
export type ParsedCsv = { header: string[]; records: CsvRecord[]; errors: CsvError[] }

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'

/**
 * Normalise a number typed in a spreadsheet: Arabic-Indic and Persian digits become Latin digits, the Arabic decimal
 * separator (U+066B) becomes '.', and surrounding spaces go. Grouping separators are NOT removed (a comma or U+066C in
 * a number is refused by the caller's number parser), so "1,5" can never be read as fifteen.
 */
export function normalizeNumber(s: string): string {
  let out = ''
  for (const ch of s.trim()) {
    const a = ARABIC_INDIC.indexOf(ch)
    const p = PERSIAN.indexOf(ch)
    out += a >= 0 ? String(a) : p >= 0 ? String(p) : ch === '٫' ? '.' : ch
  }
  return out
}

function splitRecords(text: string, delimiter: string): { records: { row: number; cells: string[] }[]; error?: CsvError } {
  const records: { row: number; cells: string[] }[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let afterQuote = false
  let started = false
  // record index: 0 = header, 1 = first data row
  let index = 0
  const endCell = () => {
    cells.push(cell)
    cell = ''
    afterQuote = false
  }
  const endRecord = () => {
    endCell()
    records.push({ row: index, cells })
    index++
    cells = []
    started = false
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
          afterQuote = true
        }
      } else cell += ch
      continue
    }
    if (ch === '"') {
      if (cell.trim() !== '' || afterQuote) return { records, error: { row: index, message: 'a quote inside an unquoted field' } }
      cell = ''
      quoted = true
      started = true
      continue
    }
    if (ch === delimiter) {
      endCell()
      started = true
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRecord()
      continue
    }
    if (afterQuote) {
      if (ch === ' ' || ch === '\t') continue
      return { records, error: { row: index, message: 'text after a closing quote' } }
    }
    cell += ch
    started = true
  }
  if (quoted) return { records, error: { row: index, message: 'a quoted field is not closed' } }
  if (started || cell !== '' || cells.length) endRecord()
  return { records }
}

/** Parse CSV text into a header (trimmed, lower-cased) and its data records (cells trimmed). See the file header. */
export function parseCsv(input: string): ParsedCsv {
  if (typeof input !== 'string') return { header: [], records: [], errors: [{ row: 0, message: 'the file is not text' }] }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','
  const { records, error } = splitRecords(text, delimiter)
  const blank = (r: { cells: string[] }) => r.cells.every((c) => c.trim() === '')
  const headerRec = records.find((r) => r.row === 0)
  if (!headerRec || blank(headerRec)) return { header: [], records: [], errors: [{ row: 0, message: 'the header row is missing' }] }
  const header = headerRec.cells.map((c) => c.trim().toLowerCase())
  const errors: CsvError[] = error ? [error] : []
  const data = records.filter((r) => r.row > 0 && !blank(r)).map((r) => ({ row: r.row, cells: r.cells.map((c) => c.trim()) }))
  return { header, records: data, errors }
}
