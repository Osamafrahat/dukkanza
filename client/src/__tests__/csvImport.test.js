// CSV import engine: parsing, EN+AR auto-mapping, cell cleaning, item
// building and the preview that mirrors server-side row errors.
//
// Why this file exists: the whole "understand the file" step is
// deterministic guessing — it must stay explainable and testable. The
// suites below pin the three contracts the UI depends on:
//   1. parsing survives real-world files (BOM, CRLF, quoted separators,
//      blank lines) and keeps record indexes aligned with file lines;
//   2. auto-map folds EN + AR synonyms onto the same normalized key and
//      value-gates every guess (a "phone" column full of names stays
//      unmapped so the user decides);
//   3. the cleaners are byte-identical in behavior to the server's
//      importClean.js (Arabic-Indic digits, Egyptian phone formats) — the
//      preview shows what the server will do.

import { describe, it, expect } from 'vitest'
import {
  ENTITY_FIELDS,
  parseCsv,
  detectDelimiter,
  normalizeKey,
  toAsciiDigits,
  cleanNum,
  cleanPhone,
  autoMap,
  buildImportItems,
  previewIssues,
} from '../lib/csvImport'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('splits headers from rows with no phantom trailing row', () => {
    const { headers, rows, headerLine } = parseCsv('name,price\nCola,10\n')
    expect(headers).toEqual(['name', 'price'])
    expect(rows).toEqual([['Cola', '10']])
    expect(headerLine).toBe(1)
  })

  it('survives a BOM and CRLF line endings', () => {
    const { headers, rows } = parseCsv('\uFEFFname,price\r\nCola,10\r\n')
    expect(headers).toEqual(['name', 'price'])
    expect(rows).toEqual([['Cola', '10']])
  })

  it('keeps quoted separators, escaped quotes and embedded newlines in the cell', () => {
    const { headers, rows } = parseCsv('h1,h2,h3\r\n"hello, world","say ""hi""","line1\nline2"\r\n')
    expect(headers).toEqual(['h1', 'h2', 'h3'])
    expect(rows).toEqual([['hello, world', 'say "hi"', 'line1\nline2']])
  })

  it('treats a quote mid-cell as a literal character', () => {
    const { rows } = parseCsv('item\n5" nails\n')
    expect(rows).toEqual([['5" nails']])
  })

  it('keeps interior blank lines as records so file line numbers stay exact', () => {
    const { headers, rows, headerLine } = parseCsv('name\nA\n\nB\n')
    expect(headers).toEqual(['name'])
    expect(rows).toEqual([['A'], [''], ['B']])
    expect(headerLine).toBe(1)
    // B sits on line 4 of the file; the blank record must not shift it.
    const items = buildImportItems(rows, { name: 0 }, 'customers', headerLine)
    expect(items.map((i) => i._row)).toEqual([2, 4])
  })

  it('finds the header after leading blank lines from a paste', () => {
    const { headers, rows, headerLine } = parseCsv('\n\nname,price\nCola,10\n')
    expect(headers).toEqual(['name', 'price'])
    expect(headerLine).toBe(3)
    const items = buildImportItems(rows, { name: 0 }, 'customers', headerLine)
    expect(items[0]._row).toBe(4) // Cola really is on line 4
  })

  it('parses an empty / header-only input without throwing', () => {
    expect(parseCsv('')).toMatchObject({ headers: [], rows: [] })
    expect(parseCsv('name,price')).toMatchObject({ headers: ['name', 'price'], rows: [] })
  })
})

describe('detectDelimiter', () => {
  it('picks the most frequent delimiter outside quotes', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('"a;b;c",d\n')).toBe(',') // quoted semis don't count
  })

  it('defaults to comma when nothing occurs', () => {
    expect(detectDelimiter('header\nvalue')).toBe(',')
  })
})

// ---------------------------------------------------------------------------
// Normalization + cleaners
// ---------------------------------------------------------------------------

describe('normalizeKey', () => {
  it('folds case and separators so EN variants collide', () => {
    expect(normalizeKey('Product Name')).toBe(normalizeKey('product_name'))
    expect(normalizeKey('E-mail')).toBe(normalizeKey('email'))
    expect(normalizeKey('  SKU  ')).toBe('sku')
  })

  it('folds Arabic variants (hamza, tashkeel) identically on both sides', () => {
    expect(normalizeKey('إسم')).toBe(normalizeKey('اسم'))
    expect(normalizeKey('سعر')).toBe(normalizeKey('سْعَر'))
    expect(normalizeKey('اسم الصنف')).toBe('اسمالصنف')
  })
})

describe('cell cleaners', () => {
  it('toAsciiDigits converts Arabic-Indic and Persian digits', () => {
    expect(toAsciiDigits('٠١٢٣')).toBe('0123')
    expect(toAsciiDigits('۴۵۶')).toBe('456')
  })

  it('cleanNum strips currency and junk, null when no digit survives', () => {
    expect(cleanNum('1,250.50 ج.م')).toBe(1250.5)
    expect(cleanNum('١٢٥')).toBe(125)
    expect(cleanNum('50%')).toBe(50)
    expect(cleanNum('1.250.500')).toBeNull() // thousand separators: refuse rather than read 1.25
    expect(cleanNum('')).toBeNull()
    expect(cleanNum('abc')).toBeNull()
    expect(cleanNum(undefined)).toBeNull()
  })

  it('cleanPhone canonicalizes every Egyptian format to one shape', () => {
    expect(cleanPhone('01012345678')).toBe('1012345678')
    expect(cleanPhone('+20 10 1234 5678')).toBe('1012345678')
    expect(cleanPhone('00201012345678')).toBe('1012345678')
    expect(cleanPhone('201012345678')).toBe('1012345678')
    expect(cleanPhone('٠١٠١٢٣٤٥٦٧٨')).toBe('1012345678')
    // Idempotent: the server runs the same pass again.
    expect(cleanPhone(cleanPhone('01012345678'))).toBe('1012345678')
  })
})

// ---------------------------------------------------------------------------
// Auto-mapping
// ---------------------------------------------------------------------------

describe('autoMap', () => {
  it('maps EN headers by exact synonym, one column per field', () => {
    const headers = ['Product Name', 'Price', 'SKU', 'Category', 'Cost', 'Stock']
    const rows = [['Cola', '10', 'S1', 'Drinks', '6', '5']]
    const m = autoMap(headers, rows, 'products')
    expect(m).toMatchObject({ name: 0, price: 1, sku: 2, category: 3, cost_price: 4, stock_quantity: 5 })
    expect(m.low_stock_threshold).toBe('') // no column fits
  })

  it('maps Arabic headers (اسم الصنف / السعر / الكمية / التصنيف)', () => {
    const headers = ['اسم الصنف', 'السعر', 'الكمية', 'التصنيف']
    const rows = [['كولا', '١٠', '5', 'مشروبات']]
    const m = autoMap(headers, rows, 'products')
    expect(m).toMatchObject({ name: 0, price: 1, stock_quantity: 2, category: 3 })
  })

  it('fuzzy-matches headers the synonyms only contain', () => {
    expect(autoMap(['Product Name (AR)'], [['كولا']], 'products').name).toBe(0)
    expect(autoMap(['product_code'], [['S1']], 'products').sku).toBe(0)
  })

  it('value-gates a lying header: "Phone" full of names stays unmapped', () => {
    const headers = ['Name', 'Phone']
    const rows = [['Ahmed', 'Ahmed'], ['Sara', 'Sara']]
    const m = autoMap(headers, rows, 'customers')
    expect(m.name).toBe(0)
    expect(m.phone).toBe('')
  })

  it('value-gates a lying "Price" column that holds no numbers', () => {
    const m = autoMap(['Name', 'Price'], [['Cola', 'N/A'], ['Pepsi', 'ask']], 'products')
    expect(m.name).toBe(0)
    expect(m.price).toBe('')
  })

  it('rescues an unhelpful header by its values (emails)', () => {
    const m = autoMap(['Client', 'Reach'], [['Ahmed', 'a@b.com'], ['Sara', 'c@d.co']], 'customers')
    expect(m.name).toBe(0)
    expect(m.email).toBe(1)
  })

  it('gives suppliers "contact" to contact_person, not phone', () => {
    const m = autoMap(['Contact', 'Supplier'], [['Sam', 'Acme'], ['Lee', 'Beta']], 'suppliers')
    expect(m.contact_person).toBe(0)
    expect(m.name).toBe(1)
    expect(m.phone).toBe('')
  })

  it('every declared field is a key of the mapping (the UI builds selects from it)', () => {
    const m = autoMap(['only'], [['x']], 'products')
    for (const def of ENTITY_FIELDS.products) expect(m[def.field]).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Item building
// ---------------------------------------------------------------------------

describe('buildImportItems', () => {
  it('sends only mapped columns, canonicalizes phones, keeps numbers raw', () => {
    const rows = [['  Ahmed  ', '01012345678'], ['Sara', '01111111111']]
    const items = buildImportItems(rows, { name: 0, phone: 1, email: '' }, 'customers')
    expect(items).toEqual([
      { _row: 2, name: 'Ahmed', phone: '1012345678' },
      { _row: 3, name: 'Sara', phone: '1111111111' },
    ])
    // email unmapped -> key absent (updates leave the field alone)
    expect(items[0]).not.toHaveProperty('email')
  })

  it('skips blank records but keeps their line numbers in _row', () => {
    const rows = [['A'], [''], ['B']]
    const items = buildImportItems(rows, { name: 0 }, 'customers')
    expect(items).toEqual([
      { _row: 2, name: 'A' },
      { _row: 4, name: 'B' },
    ])
  })

  it('passes number cells through raw for the server to judge', () => {
    const items = buildImportItems([['Cola', '1,250.50 ج.م']], { name: 0, price: 1 }, 'products')
    expect(items[0].price).toBe('1,250.50 ج.م')
    expect(cleanNum(items[0].price)).toBe(1250.5) // ...and the preview agrees with the server
  })

  it('sends mapped-but-empty cells so the server clears the field', () => {
    const items = buildImportItems([['Cola', '']], { name: 0, notes: 1 }, 'customers')
    expect(items[0]).toHaveProperty('notes', '')
  })
})

// ---------------------------------------------------------------------------
// Preview issues (early mirror of server row errors)
// ---------------------------------------------------------------------------

describe('previewIssues', () => {
  it('flags product rows the server would reject, in file order', () => {
    const items = [
      { _row: 2, name: '', price: '10' },
      { _row: 3, name: 'No Price', price: 'abc' },
      { _row: 4, name: 'Costly', price: '5', cost_price: '8' },
      { _row: 5, name: 'A', price: '5', sku: 'S1' },
      { _row: 6, name: 'B', price: '5', sku: 's1' },
    ]
    expect(previewIssues(items, 'products')).toEqual([
      { row: 2, error: 'name_required' },
      { row: 3, error: 'price_invalid' },
      { row: 4, error: 'cost_exceeds_price' },
      { row: 6, error: 'sku_in_file_dup' },
    ])
  })

  it('flags in-file duplicate phones for customers', () => {
    const items = [
      { _row: 2, name: 'Ali', phone: '1012345678' },
      { _row: 3, name: 'Other', phone: '1012345678' },
    ]
    expect(previewIssues(items, 'customers')).toEqual([{ row: 3, error: 'phone_in_file_dup' }])
  })

  it('flags a phoneless repeated name for customers and any repeat for suppliers', () => {
    const customers = [
      { _row: 2, name: 'Ahmed', phone: '' },
      { _row: 3, name: 'Ahmed', phone: '' },
    ]
    expect(previewIssues(customers, 'customers')).toEqual([{ row: 3, error: 'name_in_file_dup' }])

    const suppliers = [
      { _row: 2, name: 'Acme' },
      { _row: 3, name: 'Acme' },
    ]
    expect(previewIssues(suppliers, 'suppliers')).toEqual([{ row: 3, error: 'name_in_file_dup' }])
  })

  it('stays quiet on clean input', () => {
    expect(previewIssues([{ _row: 2, name: 'A', price: '5' }], 'products')).toEqual([])
  })
})
