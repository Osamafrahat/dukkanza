import ConfirmModal from '../components/ConfirmModal'
import CsvImportModal from '../components/CsvImportModal'
import { Plus, Package, Tag, Printer, X, Upload } from 'lucide-react'
import InventoryPrintSheet from '../components/inventory/InventoryPrintSheet'
import BarcodePrinter from '../components/BarcodePrinter'
import CategoryManager from '../components/inventory/CategoryManager'
import ProductForm from '../components/inventory/ProductForm'
import ProductList from '../components/inventory/ProductList'
import { useState, useEffect } from 'react'
import { useProductStore } from '../stores/productStore'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { productsApi, categoriesApi, suppliersApi } from '../lib/api'

export default function InventoryPage() {
  const { products, categories, setProducts, setCategories, setLoading, setError } = useProductStore()
  const { t, settings } = useAppStore()
  const { currentUser, hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.INVENTORY_EDIT)
  const [showProductForm, setShowProductForm] = useState(false)
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [activeTab, setActiveTab] = useState('products')
  const [barcodeProduct, setBarcodeProduct] = useState(null)
  const [showPrintSheet, setShowPrintSheet] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [productsRes, categoriesRes, suppliersRes] = await Promise.all([
        productsApi.getAll(),
        categoriesApi.getAll(),
        suppliersApi.getAll()
      ])
      // Handle both paginated { data: [...] } and plain array responses
      const productsData = productsRes.data?.data || productsRes.data || []
      setProducts(productsData)
      setCategories(categoriesRes.data)
      setSuppliers(suppliersRes.data)
    } catch (err) {
      setError(err.message)
      console.error('Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEditProduct = (product) => {
    setEditingProduct(product)
    setShowProductForm(true)
  }

  const handleCreateProduct = () => {
    setEditingProduct(null)
    setShowProductForm(true)
  }

  const handleSaveProduct = async (productData) => {
    try {
      if (editingProduct) {
        await productsApi.update(editingProduct.id, productData)
      } else {
        await productsApi.create(productData)
      }
      setShowProductForm(false)
      setEditingProduct(null)
      fetchData()
    } catch (err) {
      console.error('Failed to save product:', err)
      alert(t('inventory.failedToSave'))
    }
  }

  const handleDeleteProduct = async (productId) => {
    setDeleting(true)
    try {
      await productsApi.delete(productId)
      fetchData()
      setDeleteTarget(null)
    } catch (err) {
      console.error('Failed to delete product:', err)
      alert(t('inventory.failedToDelete'))
    } finally {
      setDeleting(false)
    }
  }

  // CSV import: run the batch, refresh the list behind the modal, hand the
  // per-row report back to the modal for display (rejections surface there).
  const handleImportProducts = async (items) => {
    const res = await productsApi.importCsv(items)
    fetchData()
    return res.data
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('inventory.title')}</h1>
<p className="text-muted">{t('inventory.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowPrintSheet(true)}
className="flex items-center gap-2 px-4 py-2.5 bg-surface-tertiary rounded-lg bg-surface-hover min-h-[44px]"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">{t('inventory.printReport') || 'Print Report'}</span>
          </button>
          {canEdit && (
            <button
              onClick={() => setShowCategoryManager(true)}
className="flex items-center gap-2 px-4 py-2.5 bg-surface-tertiary rounded-lg bg-surface-hover min-h-[44px]"
            >
              <Tag className="w-4 h-4" />
              <span className="hidden sm:inline">{t('inventory.categories')}</span>
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-surface-tertiary rounded-lg bg-surface-hover min-h-[44px]"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">{t('importCsv.button')}</span>
            </button>
          )}
          {canEdit && (
            <button
              onClick={handleCreateProduct}
className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('inventory.addProduct')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
<div className="flex gap-1 p-1 bg-surface-tertiary rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'products'
?'bg-surface shadow-sm'
:'text-muted text-foreground'
          }`}
        >
          <Package className="w-4 h-4 inline mr-2" />
          {t('inventory.products')} ({products.length})
        </button>
        <button
          onClick={() => setActiveTab('low-stock')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'low-stock'
?'bg-surface shadow-sm'
:'text-muted text-foreground'
          }`}
        >
          {t('inventory.lowStock')} ({products.filter(p => p.stock_quantity <= p.low_stock_threshold).length})
        </button>
      </div>

      {/* Product List */}
      <ProductList
        products={activeTab === 'low-stock'
          ? products.filter(p => p.stock_quantity <= p.low_stock_threshold)
          : products
        }
        canEdit={canEdit}
        onEdit={handleEditProduct}
        onDelete={(id) => setDeleteTarget(id)}
        onPrintBarcode={(product) => setBarcodeProduct(product)}
      />

      {/* Product Form Modal */}
      {showProductForm && (
        <ProductForm
          product={editingProduct}
          categories={categories}
          suppliers={suppliers}
          onSave={handleSaveProduct}
          onClose={() => {
            setShowProductForm(false)
            setEditingProduct(null)
          }}
        />
      )}

      {/* Category Manager Modal */}
      {showCategoryManager && (
        <CategoryManager
          categories={categories}
          onClose={() => setShowCategoryManager(false)}
          onRefresh={fetchData}
        />
      )}

      {/* Barcode Printer Modal */}
      {barcodeProduct && (
        <BarcodePrinter
          product={barcodeProduct}
          onClose={() => setBarcodeProduct(null)}
        />
      )}

      {/* Print Inventory Sheet Modal */}
      {showPrintSheet && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-10 pb-10 overflow-y-auto">
<div className="bg-surface rounded-2xl w-full max-w-6xl mx-4 shadow-2xl">
<div className="flex items-center justify-between p-4 border-b border-border no-print">
              <h2 className="text-xl font-semibold">{t('inventory.inventoryReport') || 'Inventory Report'}</h2>
              <button
                onClick={() => setShowPrintSheet(false)}
className="p-2.5 rounded-lg bg-surface-hover min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <InventoryPrintSheet
                products={products}
                categories={categories}
                settings={settings}
                user={currentUser}
              />
            </div>
          </div>
        </div>
      )}
      {/* CSV Import Modal */}
      <CsvImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        entity="products"
        onImport={handleImportProducts}
      />

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDeleteProduct(deleteTarget)}
        title={t('inventory.deleteProduct') || 'Delete Product'}
        message={t('inventory.deleteConfirm') || 'Are you sure you want to delete this product?'}
        type="danger"
        confirmText={t('common.delete') || 'Delete'}
        cancelText={t('common.cancel') || 'Cancel'}
        loading={deleting}
      />
    </div>
  )
}
