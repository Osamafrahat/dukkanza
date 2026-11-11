// CSV parsing, smart column auto-mapping and row building for the three
// import screens (Inventory, Customers, Suppliers).
//
// The "understand the file" step is deterministic, not an LLM: headers are
// normalized (EN + AR, punctuation stripped, Arabic variants folded) and
// matched against per-field synonym lists, then confirmed against the
// column's sample values (a column called "phone" full of names must not
// map to phone). Every guess lands in a dropdown the user can override
// before a single row is written.
//
// The cleaners here are deliberate copies of server/src/helpers/importClean.js
// (same algorithm, both idempotent): the client uses them for the preview so
// what the user sees matches what the server will do, and the server runs
// them again as the authority. Keeping them independent means a preview can
// never WRITE anything — worst case the server's report disagrees slightly
// and that report is what counts.

/** Field contract per entity. Order = display order = auto-map priority
 *  (first field gets first claim on an ambiguous column).
 *  type drives cell transformation: text trims, number stays raw for the
 *  server's cleanNum, phone is canonicalized here, email trims. */
export const ENTITY_FIELDS = {
  products: [
    { field: 'name', type: 'text', required: true, aliases: [
      'name', 'product', 'product name', 'item', 'item name', 'title', 'goods', 'goods name', 'product title',
      'اسم', 'اسم المنتج', 'اسم الصنف', 'الصنف', 'المنتج', 'اسم السلعة', 'السلعة', 'اسم البضاعة', 'البضاعة', 'اسم المنتود', 'المنتجات',
    ] },
    { field: 'price', type: 'number', required: true, gate: isNumberish, aliases: [
      'price', 'sell price', 'selling price', 'retail price', 'unit price', 'sale price', 'price egp', 'msrp', 'سعر', 'السعر',
      'سعر البيع', 'سعر الوحدة', 'سعر البيع للوحدة', 'السعر بالجملة',
    ] },
    { field: 'sku', type: 'text', aliases: [
      'sku', 'code', 'product code', 'item code', 'item no', 'part number', 'ref', 'reference',
      'كود', 'كود المنتج', 'كود الصنف', 'رمز', 'رمز المنتج', 'الكود', 'الرمز', 'رقم الصنف', 'رقم',
    ] },
    { field: 'barcode', type: 'text', aliases: [
      'barcode', 'bar code', 'upc', 'ean', 'gtin', 'باركود', 'الباركود',
    ] },
    { field: 'category', type: 'text', aliases: [
      'category', 'category name', 'group', 'type', 'class', 'department',
      'التصنيف', 'الفئة', 'فئة', 'نوع', 'المجموعة', 'النوع', 'اسم التصنيف', 'مجموعة',
    ] },
    { field: 'supplier', type: 'text', aliases: [
      'supplier', 'supplier name', 'vendor', 'vendor name', 'المورد', 'اسم المورد', 'المورد العام',
    ] },
    { field: 'cost_price', type: 'number', gate: isNumberish, aliases: [
      'cost', 'cost price', 'purchase price', 'buy price', 'wholesale price', 'cost egp',
      'التكلفة', 'سعر التكلفة', 'تكلفة', 'سعر الشراء', 'سعر الجملة',
    ] },
    { field: 'stock_quantity', type: 'number', gate: isNumberish, aliases: [
      'stock', 'stock quantity', 'stock qty', 'quantity', 'qty', 'available', 'available qty', 'inventory', 'on hand',
      'الكمية', 'المخزون', 'الرصيد', 'الكمية المتوفرة', 'متوفر', 'رصيد المخزون', 'عدد',
    ] },
    { field: 'low_stock_threshold', type: 'number', gate: isNumberish, aliases: [
      'threshold', 'low stock', 'low stock threshold', 'min stock', 'minimum stock', 'reorder point', 'reorder',
      'الحد الأدنى', 'حد الطلب', 'حد إعادة الطلب', 'الحد الأدنى للمخزون',
    ] },
  ],
  customers: [
    { field: 'name', type: 'text', required: true, aliases: [
      'name', 'customer', 'customer name', 'client', 'client name', 'full name', 'customer full name',
      'الاسم', 'الاسم الكامل', 'اسم العميل', 'العميل', 'اسم الزبون', 'الزبون',
    ] },
    { field: 'phone', type: 'phone', gate: isPhoneish, aliases: [
      'phone', 'phone number', 'mobile', 'mobile number', 'tel', 'telephone', 'contact number', 'contact phone', 'cell',
      'رقم الهاتف', 'رقم', 'التليفون', 'تليفون', 'هاتف', 'الهاتف', 'الموبايل', 'الجوال', 'رقم الموبايل', 'رقم الجوال',
    ] },
    { field: 'email', type: 'email', gate: isEmailish, aliases: [
      'email', 'email address', 'mail', 'e-mail', 'e mail',
      'البريد', 'البريد الإلكتروني', 'الايميل', 'ايميل', 'بريد إلكتروني',
    ] },
    { field: 'address', type: 'text', aliases: [
      'address', 'location', 'street', 'العنوان', 'عنوان', 'العنوان الكامل', 'موقع',
    ] },
    { field: 'notes', type: 'text', aliases: [
      'notes', 'note', 'comments', 'comment', 'remark', 'remarks',
      'ملاحظات', 'ملاحظة', 'تعليقات', 'ملاحظات إضافية',
    ] },
  ],
  suppliers: [
    { field: 'name', type: 'text', required: true, aliases: [
      'name', 'supplier', 'supplier name', 'company', 'company name', 'vendor', 'vendor name', 'business name',
      'الاسم', 'اسم المورد', 'المورد', 'اسم الشركة', 'الشركة', 'اسم المنشأة', 'المنشأة',
    ] },
    { field: 'contact_person', type: 'text', aliases: [
      'contact', 'contact person', 'contact name', 'representative', 'rep', 'account manager', 'person in charge',
      'مسؤول', 'اسم المسؤول', 'مسؤول الاتصال', 'المسؤول', 'شخص الاتصال',
    ] },
    { field: 'phone', type: 'phone', gate: isPhoneish, aliases: [
      'phone', 'phone number', 'mobile', 'mobile number', 'tel', 'telephone', 'contact number', 'contact phone', 'cell',
      'رقم الهاتف', 'رقم', 'التليفون', 'تليفون', 'هاتف', 'الهاتف', 'الموبايل', 'الجوال', 'رقم الموبايل', 'رقم الجوال',
    ] },
    { field: 'email', type: 'email', gate: isEmailish, aliases: [
      'email', 'email address', 'mail', 'e-mail', 'e mail',
      'البريد', 'البريد الإلكتروني', 'الايميل', 'ايميل', 'بريد إلكتروني',
    ] },
    { field: 'address', type: 'text', aliases: [
      'address', 'location', 'street', 'العنوان', 'عنوان', 'العنوان الكامل', 'موقع',
    ] },
    { field: 'notes', type: 'text', aliases: [
      'notes', 'note', 'comments', 'comment', 'remark', 'remarks',
      'ملاحظات', 'ملاحظة', 'تعليقات', 'ملاحظات إضافية',
    ] },
  ],
}

// ---------------------------------------------------------------------------
// Cell cleaners (mirrors of server/src/helpers/importClean.js)
// ---------------------------------------------------------------------------

const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/g

export function toAsciiDigits(value) {
  return String(value ?? '').replace(ARABIC_INDIC, (d) => {
    const code = d.charCodeAt(0)
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
  })
}

// '1,250.50 ج.م' -> 1250.5, '١٢٥' -> 125, '' / 'abc' -> null.
// Multiple dots need care: a unit suffix glued on ('ج.م' leaves a
// trailing dot after stripping) vs thousand separators ('1.250.500') that
// Number() would silently misread — drop trailing dots, then refuse
// anything that still has a dot between digits.
export function cleanNum(value) {
  if (value === null || value === undefined) return null
  let stripped = toAsciiDigits(value).replace(/[^0-9.-]/g, '')
  if ((stripped.match(/\./g) || []).length > 1) {
    stripped = stripped.replace(/\.+$/, '')
    if ((stripped.match(/\./g) || []).length > 1) return null
  }
  if (!/[0-9]/.test(stripped)) return null
  const n = Number(stripped)
  return Number.isFinite(n) ? n : null
}

// Canonical Egyptian phone: digits only, collapsed to 10 digits with no
// leading 0 (the shape the customer form produces). Length is not enforced.
export function cleanPhone(value) {
  let digits = toAsciiDigits(value).replace(/\D/g, '')
  if (digits.startsWith('0020')) digits = digits.slice(4)
  if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')
  return digits
}

// Value-gate probes used by autoMap: only a minority of non-empty sample
// values has to disagree before a lexical match is trusted (0.6 threshold
// lives in autoMap; these are the per-value predicates).
function isNumberish(v) { return cleanNum(v) !== null }
function isPhoneish(v) { return cleanPhone(v).length >= 7 }
function isEmailish(v) { return /\S+@\S+\.\S+/.test(String(v)) }

// ---------------------------------------------------------------------------
// Header normalization — EN + AR synonyms must land on the same string
// ---------------------------------------------------------------------------

// Lowercase, strip tashkeel and Arabic quote marks, fold alef/hamza/teh
// marbuta variants, drop every separator (product_name == product-name ==
// "product name"). Applied to BOTH headers and aliases, so variants only
// have to agree with each other, not with a canonical spelling.
export function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '') // tashkeel + tatweel
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // آ أ إ ٱ -> ا
    .replace(/\u0629/g, '\u0647') // ة -> ه
    .replace(/[\u0624\u0626]/g, '\u0648') // ؤ ئ -> و (index marker lost on both sides)
    .replace(/[^0-9a-z\u0600-\u06FF]/g, '')
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

const DELIMITERS = [',', ';', '\t', '|']

/** Most frequent delimiter outside quotes on the first non-empty line. */
export function detectDelimiter(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const first = lines[0] ?? ''
  let best = ','
  let bestCount = 0
  for (const d of DELIMITERS) {
    let count = 0
    let inQuotes = false
    for (let i = 0; i < first.length; i++) {
      const ch = first[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (!inQuotes && ch === d) count++
    }
    if (count > bestCount) { best = d; bestCount = count }
  }
  return best
}

/**
 * RFC 4180-ish parser: quoted fields, "" escapes, CRLF/LF, BOM strip.
 * Newlines inside quotes stay inside the cell; a trailing newline does not
 * produce a phantom row. Interior blank lines are KEPT as records so that
 * every record's index still matches its line in the file (_row stays
 * exact for error reporting — buildImportItems skips the blanks). Returns
 * { headers, rows, delimiter, headerLine } where headerLine is the 1-based
 * line the header sits on (leading blank lines from a paste shift it).
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(src)
  const matrix = []
  let row = []
  let cell = ''
  let inQuotes = false
  let started = false // has this record consumed anything?

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
      started = true
      continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; started = true; continue }
    if (ch === delimiter) { row.push(cell); cell = ''; started = true; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(cell); matrix.push(row); row = []; cell = ''; started = false; continue }
    cell += ch
    started = true
  }
  if (started || cell !== '' || row.length > 0) { row.push(cell); matrix.push(row) }

  // Blank lines BEFORE the header (a paste with a leading newline) are
  // skipped so the header is still found; everything after is preserved.
  let start = 0
  while (start < matrix.length && matrix[start].every((c) => String(c).trim() === '')) start++
  const headers = (matrix[start] ?? []).map((h) => String(h).trim())
  return { headers, rows: matrix.slice(start + 1), delimiter, headerLine: start + 1 }
}

// ---------------------------------------------------------------------------
// Auto-mapping
// ---------------------------------------------------------------------------

const GATE_THRESHOLD = 0.6

function gatePass(def, colIdx, rows) {
  if (!def.gate) return true
  const vals = []
  for (const r of rows) {
    const v = r[colIdx]
    if (v !== undefined && v !== null && String(v).trim() !== '') vals.push(v)
  }
  if (vals.length === 0) return true // empty column cannot disprove the header
  let ok = 0
  for (const v of vals) if (def.gate(v)) ok++
  return ok / vals.length >= GATE_THRESHOLD
}

/**
 * Best-guess mapping field -> column index ('' when nothing fits).
 * Phase 1: exact normalized alias. Phase 2: fuzzy containment (field
 * priority order, one column per field). Phase 3: value-only rescue for
 * phone/email columns whose headers said nothing useful.
 * A value gate vetoes phases 1-2: the header may lie.
 */
export function autoMap(headers, rows, entity) {
  const defs = ENTITY_FIELDS[entity] || []
  const norm = headers.map((h) => normalizeKey(h))
  const mapping = {}
  const taken = new Set()

  // Phase 1 — exact alias.
  for (const def of defs) {
    const aliasSet = new Set(def.aliases.map(normalizeKey))
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i) || !norm[i]) continue
      if (aliasSet.has(norm[i]) && gatePass(def, i, rows)) {
        mapping[def.field] = i
        taken.add(i)
        break
      }
    }
    if (mapping[def.field] === undefined) mapping[def.field] = ''
  }

  // Phase 2 — fuzzy containment. The field is the outer loop so declared
  // priority decides who claims an ambiguous column ('اسم المورد' must reach
  // supplier, not name, once name already claimed its exact match).
  for (const def of defs) {
    if (mapping[def.field] !== '') continue
    const aliases = def.aliases.map(normalizeKey)
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i) || !norm[i]) continue
      const hit = aliases.some((a) => (a.length >= 3 && norm[i].includes(a)) || (norm[i].length >= 3 && a.includes(norm[i])))
      if (hit && gatePass(def, i, rows)) {
        mapping[def.field] = i
        taken.add(i)
        break
      }
    }
  }

  // Phase 3 — value rescue: a column nobody claimed whose values are
  // unmistakably emails or phone numbers.
  const valueOnly = defs.filter((d) => d.type === 'email' || d.type === 'phone')
  for (const def of valueOnly) {
    if (mapping[def.field] !== '') continue
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i)) continue
      if (hasEnoughSamples(i, rows) && majorityMatch(def, i, rows)) {
        mapping[def.field] = i
        taken.add(i)
        break
      }
    }
  }

  return mapping
}

// Phase 3 only fires when there is actual evidence: at least two non-empty
// values, ALL of them passing the gate (a lone "?" must not claim a column).
function hasEnoughSamples(colIdx, rows) {
  let n = 0
  for (const r of rows) {
    const v = r[colIdx]
    if (v !== undefined && v !== null && String(v).trim() !== '') n++
    if (n >= 2) return true
  }
  return false
}

function majorityMatch(def, colIdx, rows) {
  let n = 0
  let ok = 0
  for (const r of rows) {
    const v = r[colIdx]
    if (v === undefined || v === null || String(v).trim() === '') continue
    n++
    if (def.gate(v)) ok++
  }
  return n > 0 && ok / n >= 0.9
}

// ---------------------------------------------------------------------------
// Row building + preview validation
// ---------------------------------------------------------------------------

const isBlankRow = (row) => row.every((c) => String(c ?? '').trim() === '')

/**
 * Turn analyzed rows into POST /import items using the user-confirmed
 * mapping. Cells for MAPPED columns are always sent (an empty cell clears
 * that field server-side — the file is the source of truth); unmapped
 * columns are absent, which leaves the existing value alone on updates.
 * _row is the record's real line in the file (headerLine defaults to 1, so
 * the first data row is line 2) so server-side errors point at the line the
 * user sees — exact unless a quoted cell embeds newlines.
 */
export function buildImportItems(rows, mapping, entity, headerLine = 1) {
  const defs = ENTITY_FIELDS[entity] || []
  const items = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (isBlankRow(row)) continue
    const item = { _row: r + 1 + headerLine }
    for (const def of defs) {
      const col = mapping[def.field]
      if (col === '' || col === undefined || col === null) continue
      const raw = row[col] ?? ''
      const text = String(raw).trim()
      if (def.type === 'phone') item[def.field] = cleanPhone(text)
      else item[def.field] = text // number stays raw: server's cleanNum is the authority
    }
    items.push(item)
  }
  return items
}

/**
 * Client-side preview of the row errors the server will report, so the
 * user sees "row 12: no name" BEFORE spending an import. Mirrors the
 * server's per-entity rules in the same order (its report stays
 * authoritative — this is the early copy, minus table-dependent checks
 * like phone_conflict that need the existing records to evaluate).
 */
export function previewIssues(items, entity) {
  const issues = []
  const seen = new Set()
  const push = (row, error) => issues.push({ row, error })

  for (const item of items) {
    const row = item._row
    const name = String(item.name ?? '').trim()
    const addSeen = () => {
      if (item.phone) seen.add(`phone:${item.phone}`)
      if (entity === 'products' && item.sku) seen.add(`sku:${item.sku.toLowerCase()}`)
      if (entity === 'products' && item.barcode) seen.add(`barcode:${String(item.barcode).trim()}`)
      if (entity !== 'products') seen.add(`name:${name.toLowerCase()}`)
    }

    if (!name) { push(row, 'name_required'); continue }

    if (entity === 'products') {
      const price = cleanNum(item.price)
      if (price === null || price < 0) { push(row, 'price_invalid'); continue }
      const hasCost = item.cost_price !== undefined && item.cost_price !== ''
      const cost = hasCost ? cleanNum(item.cost_price) : 0
      if (cost === null || cost < 0) { push(row, 'cost_invalid'); continue }
      if (cost > price) { push(row, 'cost_exceeds_price'); continue }
      const hasStock = item.stock_quantity !== undefined && item.stock_quantity !== ''
      const stock = hasStock ? cleanNum(item.stock_quantity) : null
      if (hasStock && (stock === null || stock < 0)) { push(row, 'stock_invalid'); continue }
      const hasThreshold = item.low_stock_threshold !== undefined && item.low_stock_threshold !== ''
      const threshold = hasThreshold ? cleanNum(item.low_stock_threshold) : null
      if (hasThreshold && (threshold === null || threshold < 0)) { push(row, 'threshold_invalid'); continue }
      if (item.sku && seen.has(`sku:${item.sku.toLowerCase()}`)) { push(row, 'sku_in_file_dup'); continue }
      if (item.barcode && seen.has(`barcode:${String(item.barcode).trim()}`)) { push(row, 'barcode_in_file_dup'); continue }
      addSeen()
      continue
    }

    const phone = item.phone || ''
    if (phone && seen.has(`phone:${phone}`)) { push(row, 'phone_in_file_dup'); continue }
    // Customers: a phoneless row has only its name — a repeat inside the
    // file with nothing to tell it apart is the earlier row again.
    if (entity === 'customers' && !phone && seen.has(`name:${name.toLowerCase()}`)) {
      push(row, 'name_in_file_dup'); continue
    }
    // Suppliers: name is the identity, every repeat is a duplicate.
    if (entity === 'suppliers' && seen.has(`name:${name.toLowerCase()}`)) {
      push(row, 'name_in_file_dup'); continue
    }
    addSeen()
  }
  return issues
}
