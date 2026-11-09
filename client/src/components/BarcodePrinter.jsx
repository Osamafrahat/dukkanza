import { useState, useRef, useLayoutEffect } from 'react'
import { X, Printer, Download } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { useAppStore } from '../stores/appStore'
import { escapeHtml } from '../lib/html'
import { pickBarcodeFormat } from '../lib/barcode'

// Renders a REAL, standards-compliant barcode via JsBarcode.
//
// The previous implementation was a hand-rolled fake: bars derived from
// `charCodeAt(i) % 3` / `% 4` with no start/stop patterns, no checksum and
// no symbol structure — despite the "using Code 128" comment. No scanner in
// the world can decode that, which is why printed labels never scanned.
// It also stretched bars horizontally only (`scale(scale, 1)`), corrupting
// module widths even further.
function BarcodeSVG({ value, width = 200, height = 80, showText = true }) {
  const svgRef = useRef(null)

  useLayoutEffect(() => {
    const el = svgRef.current
    if (!el) return

    // Value Code 128 cannot encode (or no value at all): show it as plain
    // text instead of an empty box.
    const showFallback = () => {
      while (el.firstChild) el.removeChild(el.firstChild)
      el.setAttribute('viewBox', `0 0 ${width} ${height}`)
      el.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      el.setAttribute('width', String(width))
      el.setAttribute('height', String(height))
      el.setAttribute('data-format', 'none')
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', String(width / 2))
      text.setAttribute('y', String(height / 2))
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('dominant-baseline', 'middle')
      text.setAttribute('font-size', '11')
      text.setAttribute('font-family', 'monospace')
      text.setAttribute('fill', '#666666')
      text.textContent = value || '—'
      el.appendChild(text)
    }

    if (!value) {
      showFallback()
      return
    }

    const format = pickBarcodeFormat(value)
    try {
      JsBarcode(el, value, {
        format,
        width: 2,   // module width in SVG units
        height: 44, // bar height
        // Quiet zone: JsBarcode applies `margin` raw (in SVG units, not
        // module multiples), so 10 would be only 5 modules — below the
        // 10-module quiet zone both Code 128 and EAN-13 scanners expect.
        // 20 units = 10 modules at width 2.
        margin: 20,
        displayValue: showText,
        fontSize: 11,
        font: 'monospace',
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch {
      showFallback()
      return
    }

    // JsBarcode sizes the SVG to the symbol's natural dimensions (it clears
    // and rebuilds the children on every call, so re-renders never stack).
    // Keep that as the viewBox and re-apply the requested box: the default
    // preserveAspectRatio (xMidYMid meet) then scales the symbol UNIFORMLY
    // into width x height — the old `scale(scale, 1)` stretched bars
    // horizontally only, distorting module widths.
    // JsBarcode writes the size as e.g. "254px"; viewBox needs unitless
    // numbers, so parse rather than copy the raw attribute.
    const naturalW = parseFloat(el.getAttribute('width'))
    const naturalH = parseFloat(el.getAttribute('height'))
    if (naturalW > 0 && naturalH > 0) {
      el.setAttribute('viewBox', `0 0 ${naturalW} ${naturalH}`)
    }
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    el.setAttribute('width', String(width))
    el.setAttribute('height', String(height))
    el.setAttribute('data-format', format)
  }, [value, showText, width, height])

  return <svg ref={svgRef} />
}

export default function BarcodePrinter({ product, onClose, note, noteClass }) {
  const { t } = useAppStore()
  const [quantity, setQuantity] = useState(1)
  const [labelWidth, setLabelWidth] = useState(50)
  const [labelHeight] = useState(30)
  const [showText, setShowText] = useState(true)
  const printRef = useRef()

  const barcodeValue = product?.barcode || product?.sku || product?.id?.toString() || ''

  const handlePrint = () => {
    const printContent = printRef.current
    if (!printContent) return

    const printWindow = window.open('', '_blank')
    // Popup blocker returned null — bail instead of throwing on .document.
    if (!printWindow) return
    printWindow.document.write(`
      <html>
        <head>
          <title>Barcode Labels</title>
          <style>
            body { margin: 0; padding: 10px; font-family: monospace; }
            .label {
              display: inline-block;
              border: 1px dashed #ccc;
              padding: 5px;
              margin: 5px;
              text-align: center;
              page-break-inside: avoid;
            }
            .product-name { font-size: 8px; margin-bottom: 2px; }
            .product-price { font-size: 10px; font-weight: bold; }
            .product-note { font-size: 9px; font-weight: bold; margin-top: 1px; }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="no-print" style="margin-bottom: 10px;">
            <button id="print-now">Print</button>
            <button id="print-close">Close</button>
          </div>
          ${Array(quantity).fill('').map(() => `
            <div class="label" style="width: ${escapeHtml(labelWidth)}mm; height: ${escapeHtml(labelHeight)}mm;">
              <div class="product-name">${escapeHtml(product?.name || '')}</div>
              <div>${printContent.innerHTML}</div>
              <div class="product-price">$${escapeHtml(product?.price?.toFixed(2) || '0.00')}</div>
              ${note ? `<div class="product-note">${escapeHtml(String(note))}</div>` : ''}
            </div>
          `).join('')}
        </body>
      </html>
    `)
    printWindow.document.close()
    // Attached programmatically: an inline `onclick` in this window would be
    // blocked by our Content-Security-Policy, because an about:blank document
    // inherits the CSP of the opener that created it.
    printWindow.document.getElementById('print-now')?.addEventListener('click', () => printWindow.print())
    printWindow.document.getElementById('print-close')?.addEventListener('click', () => printWindow.close())
  }

  const handleDownload = () => {
    const svg = printRef.current?.querySelector('svg')
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()

    img.onload = () => {
      canvas.width = img.width * 2
      canvas.height = img.height * 2
      ctx.scale(2, 2)
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, img.width, img.height)
      ctx.drawImage(img, 0, 0)

      const link = document.createElement('a')
      link.download = `barcode-${barcodeValue}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    }

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl w-full max-w-md mx-4 shadow-2xl">
<div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">{t('barcode.printBarcode')}</h2>
          <button
            onClick={onClose}
className="p-2 rounded-lg bg-surface-hover"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Product Info */}
<div className="bg-surface-secondary rounded-lg p-3">
            <p className="font-medium">{product?.name || t('barcode.unknownProduct')}</p>
<p className="text-sm text-muted">{t('barcode.barcode')}:{barcodeValue}</p>
<p className="text-sm text-muted">{t('barcode.price')}: ${product?.price?.toFixed(2)||'0.00'}</p>
            {note && (
              <p className={`text-sm font-semibold ${noteClass || 'text-muted'}`}>{note}</p>
            )}
          </div>

          {/* Preview */}
<div ref={printRef}className="flex justify-center p-4 bg-surface border border-border rounded-lg">
            <BarcodeSVG
              value={barcodeValue}
              width={200}
              height={80}
              showText={showText}
            />
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-4">
            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('barcode.quantity')}
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                min="1"
                max="100"
className="w-full px-3 py-2 rounded-lg border border-border bg-surface"
              />
            </div>
            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('barcode.labelWidth')}
              </label>
              <input
                type="number"
                value={labelWidth}
                onChange={(e) => setLabelWidth(parseInt(e.target.value) || 50)}
                min="20"
                max="100"
className="w-full px-3 py-2 rounded-lg border border-border bg-surface"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showText"
              checked={showText}
              onChange={(e) => setShowText(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="showText" className="text-sm">{t('barcode.showText')}</label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={handleDownload}
className="flex items-center gap-2 px-4 py-2 text-foreground bg-surface-tertiary rounded-lg bg-surface-hover"
            >
              <Download className="w-4 h-4" />
              {t('barcode.download')}
            </button>
            <button
              onClick={handlePrint}
className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700"
            >
              <Printer className="w-4 h-4" />
              {t('barcode.print')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
