import { describe, expect, it } from 'vitest'
import { normalizeNumber, parseCsv } from '@/server/domain/wholesale/csv'

describe('parseCsv', () => {
  it('drops a BOM, reads CRLF, LF and CR records and lower-cases the header', () => {
    const p = parseCsv('﻿Currency, Amount\r\nIQD,1000\nUSD,5\rIRT,7')
    expect(p.errors).toEqual([])
    expect(p.header).toEqual(['currency', 'amount'])
    expect(p.records).toEqual([
      { row: 1, cells: ['IQD', '1000'] },
      { row: 2, cells: ['USD', '5'] },
      { row: 3, cells: ['IRT', '7'] },
    ])
  })

  it('handles quoted fields with delimiters, doubled quotes and line breaks', () => {
    const p = parseCsv('customer,currency,amount\n"Ali, Sons ""Ltd""",IQD,5\n"two\nlines",USD,1\n')
    expect(p.errors).toEqual([])
    expect(p.records).toEqual([
      { row: 1, cells: ['Ali, Sons "Ltd"', 'IQD', '5'] },
      { row: 2, cells: ['two\nlines', 'USD', '1'] },
    ])
  })

  it('skips blank records (trailing empty lines, a row of separators) but keeps the row numbers', () => {
    const p = parseCsv('currency,amount\nIQD,1\n\n,\nUSD,2\n\n\n')
    expect(p.records.map((r) => r.row)).toEqual([1, 4])
  })

  it('uses a semicolon delimiter when the header has semicolons and no commas', () => {
    const p = parseCsv('currency;amount\nIQD;1.5')
    expect(p.records[0].cells).toEqual(['IQD', '1.5'])
  })

  it('reports a missing header, an unclosed quote and a stray quote', () => {
    expect(parseCsv('').errors).toEqual([{ row: 0, message: 'the header row is missing' }])
    expect(parseCsv('\n\n').errors[0].row).toBe(0)
    expect(parseCsv('a,b\n1,"open').errors).toEqual([{ row: 1, message: 'a quoted field is not closed' }])
    expect(parseCsv('a,b\n1,x"y\n').errors).toEqual([{ row: 1, message: 'a quote inside an unquoted field' }])
  })
})

describe('normalizeNumber', () => {
  it('turns Arabic-Indic and Persian digits and the Arabic decimal point into Latin', () => {
    expect(normalizeNumber(' ١٢٣٫٥ ')).toBe('123.5')
    expect(normalizeNumber('۱۲۳۴')).toBe('1234')
    expect(normalizeNumber('1,000')).toBe('1,000')
  })
})
