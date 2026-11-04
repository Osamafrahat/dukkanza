import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import BarcodePrinter from '../components/BarcodePrinter'

// Regression test for "printed barcodes don't scan": BarcodePrinter used to
// draw bars from charCodeAt(i) % 3 — a fake with no start/stop patterns, no
// checksum and no symbol structure — so no physical scanner could ever
// decode it. These tests assert the output is a REAL symbol: correct
// format, spec-sized geometry, and human-readable text identical to the
// value the POS looks up.
beforeAll(() => {
  // jsdom has no canvas (the `canvas` package is not installed), so
  // JsBarcode's text measurement would hit a null 2d context and throw.
  // measureText only decides text-vs-bar width for centering; a plausible
  // monospace advance keeps the geometry representative of a real browser.
  HTMLCanvasElement.prototype.getContext = () => ({
    font: '',
    measureText: (s) => ({ width: s.length * 6.6 }),
  })
})

afterEach(cleanup)

// Scope to the barcode SVG: the modal also contains lucide-react icon
// <svg>s (close, printer, download), and every code path of BarcodeSVG —
// success or fallback — stamps data-format on it.
const svgOf = (container) => container.querySelector('svg[data-format]')
const barsIn = (svg) => svg.querySelectorAll('rect').length

// Valid EAN-13 (Coca-Cola 330ml): check digit 6.
const eanProduct = {
  id: 7,
  name: 'Sugar 1kg',
  barcode: '5449000000996',
  sku: 'SKU-SUGAR-1',
  price: 3.5,
}

describe('BarcodePrinter renders a real barcode', () => {
  it('encodes a checksum-valid 13-digit value as EAN-13', () => {
    const { container } = render(<BarcodePrinter product={eanProduct} onClose={() => {}} />)
    const svg = svgOf(container)

    expect(svg).toBeTruthy()
    expect(svg.getAttribute('data-format')).toBe('EAN13')
    // Natural geometry of the guarded EAN-13 with our options: a 12-module
    // first-digit gutter + the 95-module symbol = 107 modules at width 2,
    // plus the 20-unit quiet zone each side => 254; height = 44 bars +
    // 11px text + 2 textMargin + 2x20 margin = 97. If this drifts, the
    // symbol stopped being a spec-sized EAN-13.
    expect(svg.getAttribute('viewBox')).toBe('0 0 254 97')
    // Requested box, scaled uniformly (never the old `scale(scale, 1)`
    // horizontal-only stretch that corrupts module widths).
    expect(svg.getAttribute('width')).toBe('200')
    expect(svg.getAttribute('height')).toBe('80')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    // Actually drew bars — the fake generator is gone.
    expect(barsIn(svg)).toBeGreaterThan(5)
    // Human-readable text is the stored barcode digit for digit, so the
    // scan output matches the exact-match lookup on products.barcode.
    expect(svg.textContent).toBe('5449000000996')
  })

  it('encodes SKUs and non-EAN strings as Code 128, value verbatim', () => {
    const { container } = render(
      <BarcodePrinter product={{ ...eanProduct, barcode: 'ABC-123' }} onClose={() => {}} />
    )
    const svg = svgOf(container)

    expect(svg.getAttribute('data-format')).toBe('CODE128')
    expect(barsIn(svg)).toBeGreaterThan(5)
    expect(svg.textContent).toBe('ABC-123')
  })

  it('uses Code 128 when the EAN-13 check digit is wrong', () => {
    // Printing this as EAN-13 would be rejected or renumbered by the
    // encoder — either way the scanner could not return the stored value.
    const { container } = render(
      <BarcodePrinter product={{ ...eanProduct, barcode: '5449000000999' }} onClose={() => {}} />
    )
    const svg = svgOf(container)

    expect(svg.getAttribute('data-format')).toBe('CODE128')
    expect(svg.textContent).toBe('5449000000999')
  })

  it('does not stack bars when showText is toggled', () => {
    const { container } = render(<BarcodePrinter product={eanProduct} onClose={() => {}} />)
    const barsBefore = barsIn(svgOf(container))

    fireEvent.click(container.querySelector('#showText'))

    // JsBarcode clears the SVG before each render; a stale implementation
    // would accumulate duplicate bar runs here.
    expect(barsIn(svgOf(container))).toBe(barsBefore)
    expect(svgOf(container).textContent).toBe('')
  })

  it('falls back to plain text when there is no value to encode', () => {
    const { container } = render(
      <BarcodePrinter product={{ name: 'No identifiers', price: 1 }} onClose={() => {}} />
    )
    const svg = svgOf(container)

    expect(svg.getAttribute('data-format')).toBe('none')
    expect(svg.textContent).toBe('—')
    expect(barsIn(svg)).toBe(0)
  })
})
