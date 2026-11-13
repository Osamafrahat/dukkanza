import { useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import html2pdf from 'html2pdf.js'

export default function InventoryPrintSheet({ products, categories, settings, user }) {
  const { t } = useAppStore()
  const [generating, setGenerating] = useState(false)
  const [failed, setFailed] = useState(false)

  const totalProducts = products.length
  const totalQuantity = products.reduce((sum, p) => sum + p.stock_quantity, 0)
  const lowStockCount = products.filter(p => p.stock_quantity <= p.low_stock_threshold).length

  const getCategoryName = (categoryId) => {
    const cat = categories.find(c => c.id === categoryId)
    return cat ? cat.name : '-'
  }

  const handleDownloadPDF = () => {
    setGenerating(true)
    setFailed(false)
    const element = document.getElementById('inventory-print-content')

    const opt = {
      margin: [10, 10, 10, 10],
      filename: `Inventory_Report_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    }

    html2pdf().set(opt).from(element).save().then(() => {
      setGenerating(false)
    }).catch((err) => {
      // Never fail silently: log for debugging and show inline feedback.
      console.error('PDF generation failed:', err)
      setGenerating(false)
      setFailed(true)
    })
  }

  return (
    <>
      <div className="mb-4">
        <button
          onClick={handleDownloadPDF}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {generating ? (t('print.generating') || 'Generating PDF...') : (t('print.downloadPDF') || 'Download PDF')}
        </button>
        {failed && (
          <p className="mt-2 text-sm text-danger">{t('print.pdfFailed') || 'PDF generation failed. Please try again.'}</p>
        )}
      </div>

      <div id="inventory-print-content" dir="auto" style={{ color: '#000', fontFamily: 'Tahoma, Arial, Helvetica, sans-serif', letterSpacing: 0, padding: '0', margin: '0' }}>
        {/* Header */}
        <div style={{ borderBottom: '3px solid #000', paddingBottom: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#000', margin: '0 0 4px 0' }}>{settings?.storeName || 'Dukkanza'}</h1>
              <p style={{ fontSize: '11px', color: '#333', margin: '2px 0' }}>{settings?.storeAddress || ''}</p>
              <p style={{ fontSize: '11px', color: '#333', margin: '2px 0' }}>{settings?.storePhone || ''}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#000', margin: '0 0 2px 0' }}>{t('print.gard')}</h2>
              <p style={{ fontSize: '13px', color: '#333', margin: '2px 0' }}>{t('print.gardAr')}</p>
              <p style={{ fontSize: '10px', color: '#555', marginTop: '6px' }}>
                {t('print.date')} {new Date().toLocaleDateString('en-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              <p style={{ fontSize: '10px', color: '#555' }}>
                {t('print.time')} {new Date().toLocaleTimeString('en-EG')}
              </p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <div style={{ border: '1.5px solid #000', borderRadius: '8px', padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#555', marginBottom: '4px' }}>{t('print.totalProducts')}</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#000' }}>{totalProducts}</div>
          </div>
          <div style={{ border: '1.5px solid #000', borderRadius: '8px', padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#555', marginBottom: '4px' }}>{t('print.totalItems')}</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#000' }}>{totalQuantity.toLocaleString()}</div>
          </div>
          <div style={{ border: '1.5px solid #000', borderRadius: '8px', padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#555', marginBottom: '4px' }}>{t('print.lowStock')}</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: lowStockCount > 0 ? '#000' : '#000' }}>{lowStockCount}</div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#000', borderBottom: '2px solid #000', paddingBottom: '4px', marginBottom: '8px' }}>{t('print.stockByCategory')}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ background: '#000', color: '#fff', padding: '5px 8px', textAlign: 'left', fontWeight: '600', fontSize: '11px' }}>{t('print.category')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 8px', textAlign: 'left', fontWeight: '600', fontSize: '11px' }}>{t('print.products')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 8px', textAlign: 'left', fontWeight: '600', fontSize: '11px' }}>{t('print.quantity')}</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => {
                const catProducts = products.filter(p => p.category_id === cat.id)
                const catQty = catProducts.reduce((s, p) => s + p.stock_quantity, 0)
                if (catProducts.length === 0) return null
                return (
                  <tr key={cat.id}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #ddd', fontWeight: 500, color: '#000' }}>{cat.name}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #ddd', color: '#000' }}>{catProducts.length}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #ddd', color: '#000' }}>{catQty.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Product List */}
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#000', borderBottom: '2px solid #000', paddingBottom: '4px', marginBottom: '8px' }}>{t('print.completeProductList')}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: '600', fontSize: '10px' }}>{t('print.rowNum')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: '600', fontSize: '10px' }}>{t('print.productName')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: '600', fontSize: '10px' }}>{t('print.sku')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: '600', fontSize: '10px' }}>{t('print.barcode')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: '600', fontSize: '10px' }}>{t('print.category')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: '600', fontSize: '10px' }}>{t('print.unit') || 'Unit'}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'left', fontWeight: '600', fontSize: '10px' }}>{t('print.qty')}</th>
                <th style={{ background: '#000', color: '#fff', padding: '5px 6px', textAlign: 'center', fontWeight: '600', fontSize: '10px' }}>{t('print.check')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, index) => {
                const isLow = product.stock_quantity <= product.low_stock_threshold
                return (
                  <tr key={product.id} style={isLow ? { background: '#f5f5f5' } : {}}>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', color: '#000' }}>{index + 1}</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 500, color: '#000' }}>{product.name}</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', color: '#000' }}>{product.sku || '-'}</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', color: '#000' }}>{product.barcode || '-'}</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', color: '#000' }}>{getCategoryName(product.category_id)}</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', color: '#000' }}>
                      {product.unit_of_measure === 'kilo' ? t('print.unitKg') :
                       product.unit_of_measure === 'liter' ? t('print.unitLiter') :
                       product.unit_of_measure === 'meter' ? t('print.unitMeter') :
                       product.unit_of_measure === 'box' ? 'box' :
                       t('print.unitPcs')}
                    </td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 700, color: '#000' }}>
                      {product.stock_quantity}
                    </td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '1.5px solid #000', borderRadius: '2px' }}></span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="6" style={{ padding: '6px 8px', background: '#000', color: '#fff', textAlign: 'right', fontWeight: 'bold', fontSize: '11px' }}>{t('print.totals')}</td>
                <td style={{ padding: '6px 8px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '11px' }}>{totalQuantity.toLocaleString()}</td>
                <td style={{ padding: '6px 8px', background: '#000', color: '#fff' }}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '2px solid #000', paddingTop: '8px', marginTop: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: '9px', color: '#555' }}>{t('print.generatedBy')}</p>
              <p style={{ fontSize: '9px', color: '#000', fontWeight: 500 }}>{settings?.storeName || 'Dukkanza'}</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '10px', color: '#000', fontWeight: 600 }}>
                {t('print.preparedBy')} {user?.full_name || 'Unknown User'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '9px', color: '#555' }}>{t('print.printed')} {new Date().toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
