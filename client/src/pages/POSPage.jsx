import { Search, Zap, User, Wrench, CreditCard, WifiOff, Pause, Play, X, Keyboard } from 'lucide-react'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useProductStore } from '../stores/productStore'
import { useCartStore } from '../stores/cartStore'
import { useAppStore } from '../stores/appStore'
import { useUserStore } from '../stores/userStore'
import { useOfflineStore } from '../stores/offlineStore'
import { productsApi, categoriesApi, ordersApi, customersApi, servicesApi, servicePlansApi, subscriptionsApi, cashShiftsApi, creditSalesApi } from '../lib/api'
import { getSyncMeta, setSyncMeta } from '../lib/offlineDB'
import { formatCurrency, generateOrderNumber } from '../lib/utils'
import ProductGrid from '../components/pos/ProductGrid'
import Cart from '../components/pos/Cart'
import PaymentModal from '../components/pos/PaymentModal'
import BarcodeScanner from '../components/pos/BarcodeScanner'
import ReceiptModal from '../components/pos/ReceiptModal'
import ShortcutsHelp from '../components/pos/ShortcutsHelp'
import usePosShortcuts from '../hooks/usePosShortcuts'

export default function POSPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [showPayment, setShowPayment] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [lastOrder, setLastOrder] = useState(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [customers, setCustomers] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [services, setServices] = useState([])
  const [plans, setPlans] = useState([])
  const [activeTab, setActiveTab] = useState('products')
  const [heldTransactions, setHeldTransactions] = useState([])
  const [showHeld, setShowHeld] = useState(false)
  const [activeShift, setActiveShift] = useState(null)
  const [shiftStats, setShiftStats] = useState(null)
  const [showCashBoxPanel, setShowCashBoxPanel] = useState(false)
  const [showCashBoxModal, setShowCashBoxModal] = useState(false)
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false)
  const [closeShiftActual, setCloseShiftActual] = useState('')
  const [cashBoxBalance, setCashBoxBalance] = useState('')
  const [cashBoxNotes, setCashBoxNotes] = useState('')
  const [cashBoxSubmitting, setCashBoxSubmitting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  // -1 = no cart row selected; ↑/↓ move it, +/-/Del act on it.
  const [selectedRow, setSelectedRow] = useState(-1)
  const searchInputRef = useRef(null)
  const barcodeInputRef = useRef(null)
  const barcodeTimeoutRef = useRef(null)
  const clearCartConfirmRef = useRef(0)

  const { products, categories, setProducts, setCategories, setLoading, setError } = useProductStore()
  const { addItem, items } = useCartStore()
  const { settings, t, toastSuccess, toastError, toastInfo } = useAppStore()
  const { currentUser } = useUserStore()
  const { isOnline, cacheData, loadCachedData, queueOrder } = useOfflineStore()

  useEffect(() => {
    fetchData()
    fetchActiveShift()
    // Re-validate when connectivity returns: the offline fallback shift could
    // be stale if it was closed elsewhere while we were disconnected.
    const onOnline = () => fetchActiveShift()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [])

  const fetchActiveShift = async () => {
    try {
      const res = await cashShiftsApi.getActive()
      const shift = res.data || null
      // getActive() is already scoped to this user, so a colleague holding a
      // box open never shows up here and never gates checkout. Only the
      // cashier's own box decides whether they are selling from one.
      if (shift) fetchShiftStats()
      setActiveShift(shift)
      // Remember the open shift. Checkout is gated on activeShift and opening
      // a cash box needs the network, so without this a reload while offline
      // locked the operator out of selling entirely.
      try {
        await setSyncMeta('activeShift', { shift })
      } catch { /* cache write is best-effort — never fail the fetch over it */ }
    } catch (err) {
      // Network unreachable: fall back to the shift remembered on the last
      // successful load instead of forcing the cash-box modal (which also
      // needs the network) and dead-ending offline checkout.
      let remembered = null
      try {
        remembered = await getSyncMeta('activeShift')
      } catch { /* no local cache — behave exactly as before */ }
      setActiveShift(remembered?.shift || null)
      setShiftStats(null)
    }
  }

  const fetchShiftStats = async () => {
    try {
      const res = await cashShiftsApi.getActiveStats()
      setShiftStats(res.data || null)
    } catch (err) {
      console.error('Failed to fetch shift stats:', err)
    }
  }

  const handleOpenCashBox = async (e) => {
    e.preventDefault()
    // Re-check my own box before opening. Other cashiers holding one open is
    // fine and must not stop this one; only mine can.
    try {
      const mine = await cashShiftsApi.getActive()
      if (mine.data) {
        toastError(t('pos.shiftAlreadyOpen') || 'You already have an open cash box. Close it first.')
        setShowCashBoxModal(false)
        await fetchActiveShift()
        return
      }
    } catch {}
    if (!cashBoxBalance || parseFloat(cashBoxBalance) < 0) {
      toastError(t('pos.invalidOpeningBalance'))
      return
    }
    try {
      setCashBoxSubmitting(true)
      await cashShiftsApi.open({
        opening_balance: parseFloat(cashBoxBalance),
        notes: cashBoxNotes
      })
      toastSuccess(t('pos.cashBoxOpened'))
      setShowCashBoxModal(false)
      setCashBoxBalance('')
      setCashBoxNotes('')
      await fetchActiveShift()
    } catch (err) {
      toastError(err.message || t('pos.openCashBoxFailed'))
    } finally {
      setCashBoxSubmitting(false)
    }
  }

  const handleCloseShift = async () => {
    if (!closeShiftActual || parseFloat(closeShiftActual) < 0) {
      toastError(t('pos.invalidActualCash'))
      return
    }
    try {
      setCashBoxSubmitting(true)
      await cashShiftsApi.close(activeShift.id, {
        closing_balance: parseFloat(closeShiftActual) || 0,
        actual_cash: parseFloat(closeShiftActual),
        notes: ''
      })
      toastSuccess(t('pos.cashBoxClosed'))
      setShowCloseShiftModal(false)
      setCloseShiftActual('')
      setActiveShift(null)
      setShiftStats(null)
      setShowCashBoxPanel(false)
    } catch (err) {
      toastError(err.message || t('pos.closeCashBoxFailed'))
    } finally {
      setCashBoxSubmitting(false)
    }
  }

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  useEffect(() => {
    const focusBarcode = (e) => {
      if (showPayment || showReceipt) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      barcodeInputRef.current?.focus()
    }
    document.addEventListener('click', focusBarcode)
    return () => document.removeEventListener('click', focusBarcode)
  }, [showPayment, showReceipt])

  const handleBarcodeInput = (e) => {
    const value = e.target.value
    if (barcodeTimeoutRef.current) clearTimeout(barcodeTimeoutRef.current)
    barcodeTimeoutRef.current = setTimeout(async () => {
      if (value.trim()) {
        await handleBarcodeScan(value.trim())
        if (barcodeInputRef.current) barcodeInputRef.current.value = ''
      }
    }, 150)
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const cached = await loadCachedData()
      if (cached.products.length > 0) {
        setProducts(cached.products)
        setCategories(cached.categories)
        setCustomers(cached.customers)
        if (cached.services?.length) setServices(cached.services)
        if (cached.plans?.length) setPlans(cached.plans)
        setLoading(false)
      }

      if (navigator.onLine) {
        try {
          const [productsRes, categoriesRes, customersRes, servicesRes, plansRes] = await Promise.all([
            productsApi.getAll(),
            categoriesApi.getAll(),
            customersApi.getAll(),
            servicesApi.getAll(),
            servicePlansApi.getAll(),
          ])
          const productsData = productsRes.data?.data || productsRes.data || []
          setProducts(productsData)
          setCategories(categoriesRes.data)
          setCustomers(customersRes.data)
          const servicesData = (servicesRes.data || []).filter(s => s.is_active !== false).map(s => ({ ...s, _type: 'service' }))
          setServices(servicesData)
          const plansData = (plansRes.data || []).filter(p => p.is_active !== false).map(p => ({ ...p, _type: 'subscription' }))
          setPlans(plansData)

          await cacheData({
            products: productsData,
            categories: categoriesRes.data,
            customers: customersRes.data,
            services: servicesData,
            plans: plansData,
            settings: { taxRate: settings.taxRate, storeName: settings.storeName, currency: settings.currency },
          })
        } catch (err) {
          console.error('Background fetch failed, using cache:', err)
        }
      } else if (cached.products.length === 0) {
        setError('No offline data available. Please connect to the internet first.')
      }
    } catch (err) {
      console.error('Failed to load data:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e) => {
    setSearchQuery(e.target.value)
  }

  // Server lookup for a barcode — the source of truth when the local list
  // does not hold the product (GET /products returns only the first
  // 100/page) and when local stock says no but the list may be stale.
  // Returns the product or null; never throws (offline included).
  const fetchProductByBarcode = async (barcode) => {
    if (!navigator.onLine) return null
    try {
      const response = await productsApi.getByBarcode(barcode)
      return response.data || null
    } catch (err) {
      console.error('Product lookup failed:', barcode, err)
      return null
    }
  }

  // Merge a fresher server record into the stored list (matched by id) so
  // the NEXT scan validates against current stock. Reads the store's CURRENT
  // state — this runs long after the render whose `products` it would
  // otherwise overwrite.
  const mergeFreshProduct = (fresh) => {
    const { products: current, setProducts: setList } = useProductStore.getState()
    if (!current.some(p => p.id === fresh.id)) return
    setList(current.map(p => (p.id === fresh.id ? { ...p, ...fresh } : p)))
  }

  const handleBarcodeScan = async (barcode) => {
    if (!barcode) return null

    // Local-first: the product list was loaded WITH the branch-stock
    // overlay and is re-fetched after every sale, so a barcode it knows can
    // go straight into the cart. Blocking on GET /products/barcode/:barcode
    // (Vercel → Fly → Supabase, plus that route's own stock-overlay query)
    // before the cart updated is what made camera scanning feel slow — the
    // round trip now only happens where it adds information.
    const localProduct = products.find(p => p.barcode === barcode)
    if (localProduct) {
      const added = addItem(localProduct)
      if (added) {
        // Advisory freshness check, OFF the critical path: another till may
        // have sold the last unit since this list loaded. Warn if the server
        // says it is gone, and store the fresh numbers either way.
        fetchProductByBarcode(barcode).then(fresh => {
          if (!fresh || fresh.id !== localProduct.id) return
          if (fresh.stock_quantity !== localProduct.stock_quantity) {
            mergeFreshProduct(fresh)
            if (fresh.stock_quantity <= 0) {
              toastError(t('pos.outOfStock') || 'Out of stock')
            }
          }
        })
        return localProduct.name
      }

      // Local stock rejected the add — but the list can lag (receiving on
      // another device, a till that was offline). Verify against the server
      // before telling the cashier "no"; only a real rejection toasts.
      const fresh = await fetchProductByBarcode(barcode)
      if (fresh) {
        if (fresh.id === localProduct.id) mergeFreshProduct(fresh)
        if (addItem(fresh)) return fresh.name
        if (fresh.stock_quantity <= 0) {
          toastError(t('pos.outOfStock') || 'Out of stock')
        } else {
          toastError(`${t('pos.insufficientStock') || 'Insufficient stock'} (${t('inventory.inStock')}: ${fresh.stock_quantity})`)
        }
        return fresh.name
      }
      if (localProduct.stock_quantity <= 0) {
        toastError(t('pos.outOfStock') || 'Out of stock')
      } else {
        toastError(`${t('pos.insufficientStock') || 'Insufficient stock'} (${t('inventory.inStock')}: ${localProduct.stock_quantity})`)
      }
      return localProduct.name
    }

    // Not in the local list at all — ask the server (it may hold barcodes
    // beyond the first page). Same path as before.
    const product = await fetchProductByBarcode(barcode)
    if (product) {
      const added = addItem(product)
      if (!added) {
        if (product.stock_quantity <= 0) {
          toastError(t('pos.outOfStock') || 'Out of stock')
        } else {
          toastError(`${t('pos.insufficientStock') || 'Insufficient stock'} (${t('inventory.inStock')}: ${product.stock_quantity})`)
        }
      }
      return product.name
    }
    console.error('Product not found:', barcode)
    return null
  }

  const handleHold = () => {
    if (items.length === 0) return
    const held = {
      id: Date.now(),
      items: [...items],
      total: items.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
      customer: selectedCustomer,
      timestamp: new Date().toISOString(),
    }
    setHeldTransactions(prev => [...prev, held])
    useCartStore.getState().clearCart()
    setSelectedCustomer(null)
    toastSuccess(t('pos.transactionHeld') || 'Transaction held')
  }

  const handleRecall = (held) => {
    useCartStore.getState().clearCart()
    held.items.forEach(item => addItem(item.product, item.quantity))
    setSelectedCustomer(held.customer || null)
    setHeldTransactions(prev => prev.filter(h => h.id !== held.id))
    setShowHeld(false)
  }

  // Dropping a held order: there was previously no way to dismiss one, so they
  // just accumulated in the recall list until the page was reloaded.
  const handleDiscardHeld = (held) => {
    setHeldTransactions(prev => prev.filter(h => h.id !== held.id))
  }

  // ---- Keyboard shortcuts (mapping lives in lib/posShortcuts.js) ----
  const modalOpen = showPayment || showReceipt || showScanner || showCashBoxModal || showCloseShiftModal || showHelp

  // Esc: close the topmost window; with nothing open, clear the search and
  // snap focus back to the barcode field — the cashier's "undo my last
  // keystrokes" key.
  const handleEscape = () => {
    if (showHelp) { setShowHelp(false); return }
    if (showPayment) { setShowPayment(false); return }
    if (showReceipt) { setShowReceipt(false); setLastOrder(null); return }
    if (showScanner) { setShowScanner(false); return }
    if (showCashBoxModal) { setShowCashBoxModal(false); return }
    if (showCloseShiftModal) { setShowCloseShiftModal(false); return }
    if (showHeld) { setShowHeld(false); return }
    if (showCashBoxPanel) { setShowCashBoxPanel(false); return }
    setSearchQuery('')
    setSelectedCategory(null)
    if (barcodeInputRef.current) barcodeInputRef.current.value = ''
    barcodeInputRef.current?.focus()
  }

  // F8 is destructive, so it takes two presses within 1.5s.
  const handleClearCartRequest = () => {
    if (items.length === 0) return
    const now = Date.now()
    if (now - clearCartConfirmRef.current < 1500) {
      clearCartConfirmRef.current = 0
      useCartStore.getState().clearCart()
      setSelectedRow(-1)
      toastSuccess(t('pos.cartCleared') || 'Cart cleared')
    } else {
      clearCartConfirmRef.current = now
      toastInfo(t('pos.cartClearConfirm') || 'Press F8 again to clear the cart')
    }
  }

  const moveRow = (delta) => {
    const n = items.length
    if (n === 0) return
    setSelectedRow((prev) => {
      if (prev < 0) return delta > 0 ? 0 : n - 1
      return Math.min(n - 1, Math.max(0, prev + delta))
    })
  }

  const bumpRowQty = (delta) => {
    const item = items[selectedRow]
    if (!item) return
    useCartStore.getState().updateQuantity(item.product.id, item.quantity + delta, item.product._type, item.sellMode)
  }

  const removeSelectedRow = () => {
    const item = items[selectedRow]
    if (!item) return
    useCartStore.getState().removeItem(item.product.id, item.product._type, item.sellMode)
  }

  // Keep the selection inside the cart when items leave it (sale completed,
  // row deleted, held order recalled...).
  useEffect(() => {
    setSelectedRow((prev) => (prev >= items.length ? items.length - 1 : prev))
  }, [items.length])

  usePosShortcuts(
    {
      escape: handleEscape,
      help: () => setShowHelp((v) => !v),
      focusBarcode: () => barcodeInputRef.current?.focus(),
      focusSearch: () => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      },
      held: () => setShowHeld((v) => !v),
      clearCart: handleClearCartRequest,
      scanner: () => setShowScanner(true),
      hold: handleHold,
      tabProducts: () => setActiveTab('products'),
      tabServices: () => setActiveTab('services'),
      tabSubscriptions: () => setActiveTab('subscriptions'),
      rowUp: () => moveRow(-1),
      rowDown: () => moveRow(1),
      qtyUp: () => bumpRowQty(1),
      qtyDown: () => bumpRowQty(-1),
      removeRow: removeSelectedRow,
    },
    () => ({ modalOpen })
  )

  // Held orders are same-day, so time alone is what tells two rows apart.
  const formatHeldTime = (iso) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const handleQuickSale = async (product, quantity = 1) => {
    const added = addItem(product, quantity)
    if (!added) {
      if (product.stock_quantity <= 0) {
        toastError(t('pos.outOfStock') || 'Out of stock')
      } else {
        toastError(`${t('pos.insufficientStock') || 'Insufficient stock'} (${t('inventory.inStock')}: ${product.stock_quantity})`)
      }
    }
  }

  const filteredProducts = useMemo(() => products.filter(p => {
    if (!p.is_active) return false
    if (selectedCategory && p.category_id !== selectedCategory) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        p.name.toLowerCase().includes(query) ||
        p.sku?.toLowerCase().includes(query) ||
        p.barcode?.includes(searchQuery)
      )
    }
    return true
  }), [products, selectedCategory, searchQuery])

  const filteredServices = useMemo(() => services.filter(s => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        s.name.toLowerCase().includes(query) ||
        s.name_ar?.toLowerCase().includes(query)
      )
    }
    return true
  }), [services, searchQuery])

  const filteredPlans = useMemo(() => plans.filter(p => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        p.name.toLowerCase().includes(query) ||
        p.name_ar?.toLowerCase().includes(query)
      )
    }
    return true
  }), [plans, searchQuery])

  const filteredCustomers = useMemo(() => customers.filter(c => {
    if (!customerSearch) return true
    const query = customerSearch.toLowerCase()
    return c.name?.toLowerCase().includes(query) || c.phone?.includes(query)
  }), [customers, customerSearch])

  const displayItems = activeTab === 'products' ? filteredProducts : activeTab === 'services' ? filteredServices : filteredPlans

  return (
    <div className="flex flex-col md:flex-row h-auto md:h-[calc(100vh-8rem)] gap-3 md:gap-4 overflow-visible md:overflow-hidden">
      {/* Offline Banner */}
      {!isOnline && (
<div className="flex items-center gap-2 px-4 py-2.5 bg-warning text-white text-sm font-medium rounded-xl shrink-0">
          <WifiOff className="w-4 h-4" />
          {t('offline.offline') || 'You are offline'} — {t('offline.ordersWillBeQueued') || 'Orders will be saved and synced when connected'}
        </div>
      )}

      {/* Left side - Products/Services */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 md:gap-4 overflow-y-auto">
        {/* Cash Box Panel */}
        {activeShift && (
          <div className="shrink-0">
            <button
              onClick={() => setShowCashBoxPanel(!showCashBoxPanel)}
className="flex items-center gap-2 px-4 py-2 bg-success-soft border border-success text-success-soft-foreground text-sm font-medium rounded-xl hover:bg-green-100 transition-colors w-full"
            >
<span className="w-2 h-2 rounded-full bg-success animate-pulse"/>
              {t('pos.cashBoxOpen') || 'Cash Box Open'}
              {shiftStats && (
                <span className="ml-auto text-xs opacity-75">
                  {t('pos.sales') || 'Sales'}: {formatCurrency(shiftStats.total_sales)}
                </span>
              )}
            </button>

            {showCashBoxPanel && shiftStats && (
<div className="mt-2 bg-surface rounded-xl border border-border p-4 shadow-lg">
                <div className="grid grid-cols-2 gap-3">
<div className="bg-accent-soft rounded-lg p-3">
<p className="text-xs text-accent mb-1">{t('openingBalance')||'Opening'}</p>
<p className="text-lg font-bold text-accent">{formatCurrency(shiftStats.opening_balance)}</p>
                  </div>
<div className="bg-success-soft rounded-lg p-3">
<p className="text-xs text-success mb-1">{t('pos.totalCash')||'Cash Received'}</p>
<p className="text-lg font-bold text-success">{formatCurrency(shiftStats.total_cash)}</p>
                  </div>
<div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
<p className="text-xs text-purple-600 dark:text-purple-400 mb-1">{t('pos.totalOrders')||'Orders'}</p>
<p className="text-lg font-bold text-purple-700 dark:text-purple-300">{shiftStats.total_orders}</p>
                  </div>
<div className="bg-warning-soft rounded-lg p-3">
<p className="text-xs text-warning mb-1">{t('expectedCash')||'Expected Cash'}</p>
<p className="text-lg font-bold text-warning">{formatCurrency(shiftStats.expected_cash)}</p>
                  </div>
                </div>
<div className="mt-3 pt-3 border-t border-border">
                  <button
                    onClick={() => setShowCloseShiftModal(true)}
className="w-full py-2 rounded-lg bg-danger-soft border border-danger text-danger-soft-foreground text-sm font-medium hover:bg-red-100 transition-colors"
                  >
                    {t('closeShift') || 'Close Shift'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search and Filters */}
        <div className="flex gap-2 md:gap-3">
          <div className="flex-1 relative min-w-0">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted"/>
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t('pos.search')}
              value={searchQuery}
              onChange={handleSearch}
className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-surface ring-focus focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowScanner(true)}
className="px-4 py-3 bg-accent text-white rounded-lg hover:bg-primary-700 flex items-center gap-2 shrink-0"
          >
            <Zap className="w-5 h-5" />
            <span className="hidden sm:inline">{t('pos.scan')}</span>
          </button>
          {items.length > 0 && (
            <button
              onClick={handleHold}
className="px-4 py-3 bg-warning text-white rounded-lg hover:bg-amber-600 flex items-center gap-2 shrink-0"
            >
              <Pause className="w-5 h-5" />
              <span className="hidden sm:inline">{t('pos.hold') || 'Hold'}</span>
            </button>
          )}
          {heldTransactions.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setShowHeld(!showHeld)}
className="px-4 py-3 bg-success text-white rounded-lg hover:bg-emerald-600 flex items-center gap-2"
              >
                <Play className="w-5 h-5" />
                <span className="hidden sm:inline">{t('pos.recall') || 'Recall'}</span>
<span className="ms-1 bg-white/20 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{heldTransactions.length}</span>
              </button>
              {showHeld && (
<div className="absolute z-20 top-full end-0 mt-2 w-80 bg-surface border border-border rounded-xl shadow-xl max-h-72 overflow-y-auto">
<div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-2.5 bg-surface-secondary border-b border-border rounded-t-xl">
<p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {t('pos.heldTransactions') || 'Held Transactions'}
                    </p>
<span className="text-xs font-bold text-success-soft-foreground bg-success-soft px-2 py-0.5 rounded-full">
                      {heldTransactions.length}
                    </span>
                  </div>
                  {heldTransactions.map(held => (
                    <div
                      key={held.id}
className="flex items-stretch border-b border-border last:border-b-0"
                    >
                      <button
                        onClick={() => handleRecall(held)}
className="flex-1 min-w-0 px-3 py-2.5 text-start bg-surface-hover flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
<p className="text-sm font-medium text-foreground truncate">
                            {held.items.length} {held.items.length === 1 ? (t('pos.item') || 'item') : (t('pos.items') || 'items')}
                            {held.customer?.name && (
<span className="font-normal text-muted">·{held.customer.name}</span>
                            )}
                          </p>
<p className="text-xs text-muted">
                            {formatCurrency(held.total)}
                            {held.timestamp && (
<span className="text-muted">·{formatHeldTime(held.timestamp)}</span>
                            )}
                          </p>
                        </div>
<Play className="w-4 h-4 shrink-0 text-success"/>
                      </button>
                      <button
                        onClick={() => handleDiscardHeld(held)}
                        aria-label={t('common.delete') || 'Delete'}
                        title={t('common.delete') || 'Delete'}
className="px-2.5 shrink-0 text-foreground hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            title={t('pos.shortcutHelp') || 'Keyboard shortcuts'}
            className="px-3 py-3 bg-surface border border-border text-muted rounded-lg hover:bg-surface-hover hover:text-foreground flex items-center gap-1.5 shrink-0 transition-colors"
          >
            <Keyboard className="w-5 h-5" />
            <span className="hidden md:inline text-xs font-bold font-mono">F1</span>
          </button>
        </div>

        {/* Products / Services / Subscriptions Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mb-1">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-3 md:px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'products'
?'bg-accent text-white'
:'bg-surface-tertiary text-foreground bg-surface-hover'
            }`}
          >
            {t('pos.productsTab') || 'Products'}
          </button>
          <button
            onClick={() => setActiveTab('services')}
            className={`px-3 md:px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'services'
?'bg-accent text-white'
:'bg-surface-tertiary text-foreground bg-surface-hover'
            }`}
          >
            <Wrench className="w-4 h-4" />
            {t('pos.services') || 'Services'}
          </button>
          <button
            onClick={() => setActiveTab('subscriptions')}
            className={`px-3 md:px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'subscriptions'
?'bg-accent text-white'
:'bg-surface-tertiary text-foreground bg-surface-hover'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            {t('pos.subscriptions') || 'Subscriptions'}
          </button>
        </div>

        {/* Category Filter (only for products) */}
        {activeTab === 'products' && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCategory(null)}
                className={`px-3 md:px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  !selectedCategory
?'bg-accent text-white'
:'bg-surface-tertiary text-foreground bg-surface-hover'
              }`}
            >
              {t('pos.allProducts')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`px-3 md:px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === category.id
?'bg-accent text-white'
:'bg-surface-tertiary text-foreground bg-surface-hover'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}

        {/* Product/Service Grid */}
        <ProductGrid
          products={displayItems}
          onAddToCart={handleQuickSale}
        />
      </div>

      {/* Right side - Cart */}
      <div className="w-full md:w-80 xl:w-96 flex-shrink-0 flex flex-col gap-2 md:gap-3 min-w-0 overflow-y-auto md:overflow-y-auto border-t md:border-t-0 pt-3 md:pt-0">
        {/* Customer Selection */}
<div className="bg-surface rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-2">
<User className="w-4 h-4 text-muted"/>
<span className="text-sm font-medium text-muted">{t('pos.selectCustomer')}</span>
          </div>
          {selectedCustomer ? (
<div className="flex items-center justify-between bg-accent-soft rounded-lg p-2">
              <div>
                <p className="font-medium text-sm">{selectedCustomer.name}</p>
<p className="text-xs text-muted">{selectedCustomer.phone ||''}|{selectedCustomer.loyalty_points || 0}pts</p>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
className="text-muted hover:text-red-500 text-sm"
              >
                {t('pos.remove')}
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                placeholder={t('pos.searchCustomer')}
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface"
              />
              {customerSearch && filteredCustomers.length > 0 && (
<div className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-40 overflow-auto">
                  {filteredCustomers.slice(0, 5).map(customer => (
                    <button
                      key={customer.id}
                      onClick={() => {
                        setSelectedCustomer(customer)
                        setCustomerSearch('')
                      }}
className="w-full px-3 py-2 text-left text-sm bg-surface-hover"
                    >
                      <p className="font-medium">{customer.name}</p>
<p className="text-xs text-muted">{customer.phone ||''}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Barcode Scanner Input */}
<div className="bg-surface rounded-xl border border-border p-3">
          <input
            ref={barcodeInputRef}
            type="text"
            onChange={handleBarcodeInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const value = barcodeInputRef.current?.value?.trim()
                if (value) {
                  handleBarcodeScan(value)
                  barcodeInputRef.current.value = ''
                }
              }
            }}
            placeholder={t('pos.scanBarcode') || 'Scan barcode here...'}
className="w-full px-3 py-2 text-sm rounded-lg border-2 border-dashed border-accent bg-accent-soft ring-focus focus:border-solid"
            autoComplete="off"
          />
        </div>

        <div className="flex-1">
          <Cart selectedRow={selectedRow} onCheckout={() => {
            // No box of my own open -> offer to open one. Another cashier
            // being on the floor is irrelevant to this decision.
            if (!activeShift) {
              setShowCashBoxModal(true)
              return
            }
            setShowPayment(true)
          }} />
        </div>
      </div>

      {/* Keyboard shortcuts help (F1) */}
      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}

      {/* Payment Modal */}
      {showPayment && (
        <PaymentModal
          onClose={() => setShowPayment(false)}
          isSubmitting={isSubmitting}
          selectedCustomer={selectedCustomer}
          onComplete={async (paymentData) => {
            if (isSubmitting) return
            setIsSubmitting(true)
            try {
              // Cash change is only knowable here: PaymentModal records it per
              // payment and the receipt renders order.change, which nothing
              // else was ever populating.
              const changeDue = (paymentData.payments || []).reduce((s, p) => s + (p.change || 0), 0)

              const productItems = items.filter(i => i.product._type !== 'service' && i.product._type !== 'subscription')
              const serviceItems = items.filter(i => i.product._type === 'service')
              const subscriptionItems = items.filter(i => i.product._type === 'subscription')

              // Validate customer required for subscriptions
              if (subscriptionItems.length > 0 && !selectedCustomer) {
                toastError(t('pos.customerRequiredForSubscription') || 'Customer is required for subscriptions')
                setIsSubmitting(false)
                return
              }

              // Create subscriptions from plan items
              for (const item of subscriptionItems) {
                try {
                  if (navigator.onLine) {
                    await subscriptionsApi.quickCreate({
                      customer_id: selectedCustomer.id,
                      plan_id: item.product.id,
                      payment_method: paymentData.method,
                      notes: `POS sale - ${item.product.name}`,
                    })
                  } else {
                    // Queue subscription for sync when back online
                    await queueOrder({
                      _type: 'subscription',
                      customer_id: selectedCustomer.id,
                      plan_id: item.product.id,
                      plan_name: item.product.name,
                      payment_method: paymentData.method,
                      total: item.product.price * item.quantity,
                      user_id: currentUser?.id,
                      created_at: new Date().toISOString(),
                    })
                  }
                } catch (subErr) {
                  if (subErr.response?.status === 409) {
                    toastError(t('pos.duplicateSubscription') || 'Customer already has an active subscription for this plan')
                    setIsSubmitting(false)
                    return
                  }
                  throw subErr
                }
              }

              // Build order items for products + services (both are one-time sales)
              // Note: Subscriptions are handled separately via quickCreate and their own journal entries
              const allOrderItems = [
                ...productItems.map(item => {
                  const isPieceSale = item.sellMode === 'pieces'
                  const unitPrice = isPieceSale && item.product.pieces_per_box
                    ? item.product.price / item.product.pieces_per_box
                    : item.product.price
                  return {
                    product_id: item.product.id,
                    product_name: item.product.name,
                    quantity: item.quantity,
                    unit_price: unitPrice,
                    sell_mode: item.sellMode || null,
                    _type: 'product',
                  }
                }),
                ...serviceItems.map(item => ({
                  product_name: item.product.name,
                  quantity: item.quantity,
                  unit_price: item.product.price,
                  sell_mode: null,
                  _type: 'service',
                })),
              ]

              const productSubtotal = Math.round(productItems.reduce((sum, item) => {
                const isPieceSale = item.sellMode === 'pieces' && item.product.pieces_per_box
                const unitPrice = isPieceSale ? item.product.price / item.product.pieces_per_box : item.product.price
                return sum + (unitPrice * item.quantity)
              }, 0) * 100) / 100
              const serviceSubtotal = Math.round(serviceItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0) * 100) / 100
              const orderSubtotal = Math.round((productSubtotal + serviceSubtotal) * 100) / 100
              // Real promo discount from the cart store (0 when no promo applied)
              const cartState = useCartStore.getState()
              const discountAmount = Math.round((cartState.getDiscount() || 0) * 100) / 100

              // Create order if there are products or services (subscriptions are separate)
              if (allOrderItems.length > 0) {
                const taxRate = settings.taxRate || 14
                // Discount is applied BEFORE tax, matching cartStore.getTax()
                const taxAmount = Math.round((productSubtotal - discountAmount) * (taxRate / 100) * 100) / 100
                const orderData = {
                  order_number: generateOrderNumber(),
                  items: allOrderItems,
                  subtotal: orderSubtotal,
                  discount_amount: discountAmount,
                  tax_amount: taxAmount,
                  // Matches cartStore.getTotal(): productSubtotal - discount + tax + services
                  total: Math.round((productSubtotal - discountAmount + taxAmount + serviceSubtotal) * 100) / 100,
                  payment_method: paymentData.method,
                  payment_status: paymentData.method === 'credit' ? 'pending' : 'paid',
                  payments: paymentData.payments,
                  user_id: currentUser?.id,
                  customer_id: selectedCustomer?.id || null,
                  promotion_id: cartState.promoId ?? null,
                  notes: serviceItems.length > 0 ? `Service sale - ${serviceItems.length} service(s)` : null,
                  created_at: new Date().toISOString(),
                  shift_id: activeShift?.id || null,
                  salesperson_id: currentUser?.employeeId || null,
                }

                if (navigator.onLine) {
                  const clientOrderId = `ONL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                  const response = await ordersApi.create({ ...orderData, client_order_id: clientOrderId })
                  const orderId = response.data?.id

                  // Fetch the actual order to get server-calculated total
                  let serverTotal = orderData.total
                  if (orderId) {
                    try {
                      const fullOrderRes = await ordersApi.getById(orderId)
                      if (fullOrderRes.data?.total != null) {
                        serverTotal = parseFloat(fullOrderRes.data.total)
                      }
                    } catch (e) {}
                  }

                  // Create credit sale if pay later — use server total, not client-calculated
                  if (paymentData.method === 'credit' && orderId && selectedCustomer) {
                    await creditSalesApi.create({
                      order_id: orderId,
                      customer_id: selectedCustomer.id,
                      total_amount: serverTotal,
                      due_date: paymentData.due_date,
                      notes: 'Created from POS - Pay Later',
                    })
                  }
                  let completedOrder
                  if (response.data?.id) {
                    const fullOrderRes = await ordersApi.getById(response.data.id)
                    completedOrder = {
                      ...fullOrderRes.data,
                      items: allOrderItems,
                      change: changeDue,
                    }
                  } else {
                    completedOrder = {
                      ...orderData,
                      change: changeDue,
                      users: currentUser ? { full_name: currentUser.fullName } : null,
                      customers: selectedCustomer ? { name: selectedCustomer.name } : null,
                    }
                  }
                  setLastOrder(completedOrder)
                } else {
                  const clientOrderId = await queueOrder(orderData)
                  toastSuccess(t('offline.orderQueued'))
                  setLastOrder({
                    ...orderData,
                    client_order_id: clientOrderId,
                    // change is receipt-only state; orderData itself goes to
                    // /sync/order and has no change column to write to
                    change: changeDue,
                    offline: true,
                    users: currentUser ? { full_name: currentUser.fullName } : null,
                    customers: selectedCustomer ? { name: selectedCustomer.name } : null,
                  })
                }
              } else {
                // Subscription-only: create a receipt without order
                const subscriptionTotal = subscriptionItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
                setLastOrder({
                  order_number: generateOrderNumber(),
                  created_at: new Date().toISOString(),
                  items: subscriptionItems.map(item => ({
                    product_name: item.product.name,
                    quantity: item.quantity,
                    unit_price: item.product.price,
                    _type: 'subscription',
                  })),
                  // Subscriptions sell at list price with no tax or discount, so
                  // subtotal must equal total for the receipt to balance. Omitting
                  // these made formatCurrency(undefined) print "NaN".
                  subtotal: subscriptionTotal,
                  discount_amount: 0,
                  tax_amount: 0,
                  total: subscriptionTotal,
                  payment_method: paymentData.method,
                  change: changeDue,
                  customers: selectedCustomer ? { name: selectedCustomer.name } : null,
                  users: currentUser ? { full_name: currentUser.fullName } : null,
                  subscription_sale: true,
                })
              }

              if (subscriptionItems.length > 0) {
                toastSuccess(t('pos.subscriptionCreated') || 'Subscription created')
              }
              if (serviceItems.length > 0) {
                toastSuccess(t('pos.serviceSold') || 'Service sold')
              }

              setSelectedCustomer(null)
              useCartStore.getState().clearCart()
              setShowPayment(false)
              setShowReceipt(true)

              if (navigator.onLine) {
                fetchData()
                fetchShiftStats()
              }
            } catch (err) {
              console.error('Failed to create order:', err)
              toastError(t('common.error') || 'Error')
            } finally {
              setIsSubmitting(false)
            }
          }}
        />
      )}

      {/* Barcode Scanner Modal */}
      {showScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Receipt Modal */}
      {showReceipt && lastOrder && (
        <ReceiptModal
          order={lastOrder}
          onClose={() => {
            setShowReceipt(false)
            setLastOrder(null)
          }}
        />
      )}

      {/* Cash Box Modal — forced before first sale */}
      {showCashBoxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl p-6 w-[calc(100%-2rem)] max-w-md shadow-2xl">
<h3 className="text-lg font-bold mb-1 text-foreground">
              {t('pos.openCashBox') || 'Open Cash Box'}
            </h3>
<p className="text-sm text-muted mb-4">
              {t('pos.openCashBoxDesc') || 'Enter the opening balance in the cash drawer'}
            </p>
            <form onSubmit={handleOpenCashBox} className="space-y-4">
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('cashDrawer.openingBalance') || 'Opening Balance'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  value={cashBoxBalance}
                  onChange={(e) => setCashBoxBalance(e.target.value)}
className="w-full px-4 py-3 text-2xl font-bold text-center rounded-lg border border-border bg-surface ring-focus"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('cashDrawer.notes') || 'Notes'}
                </label>
                <textarea
                  value={cashBoxNotes}
                  onChange={(e) => setCashBoxNotes(e.target.value)}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                  rows={2}
                  placeholder={t('cashDrawer.optionalNotes') || 'Optional notes'}
                />
              </div>
              <button
                type="submit"
                disabled={cashBoxSubmitting || !cashBoxBalance}
className="w-full py-3 rounded-lg bg-accent text-white font-bold text-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {cashBoxSubmitting ? '...' : (t('pos.openCashBox') || 'Open Cash Box')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      {showCloseShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl p-6 w-[calc(100%-2rem)] max-w-md shadow-2xl">
<h3 className="text-lg font-bold mb-1 text-foreground">
              {t('closeShift') || 'Close Shift'}
            </h3>
<p className="text-sm text-muted mb-4">
              {t('pos.closeCashBoxDesc') || 'Count the cash in the drawer and enter the amount'}
            </p>
            {shiftStats && (
<div className="bg-surface-secondary rounded-lg p-4 mb-4 space-y-2">
                <div className="flex justify-between text-sm">
<span className="text-muted">{t('openingBalance')||'Opening'}</span>
                  <span className="font-medium">{formatCurrency(shiftStats.opening_balance)}</span>
                </div>
                <div className="flex justify-between text-sm">
<span className="text-muted">{t('pos.totalSales')||'Total Sales'}</span>
                  <span className="font-medium">{formatCurrency(shiftStats.total_sales)}</span>
                </div>
<div className="flex justify-between text-sm border-t border-border pt-2">
<span className="text-muted font-medium">{t('expectedCash')||'Expected Cash'}</span>
<span className="font-bold text-accent">{formatCurrency(shiftStats.expected_cash)}</span>
                </div>
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); handleCloseShift() }} className="space-y-4">
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('actualCash') || 'Actual Cash (counted)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  value={closeShiftActual}
                  onChange={(e) => setCloseShiftActual(e.target.value)}
className="w-full px-4 py-3 text-2xl font-bold text-center rounded-lg border border-border bg-surface ring-focus"
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowCloseShiftModal(false); setCloseShiftActual('') }}
className="flex-1 py-3 rounded-lg border border-border text-foreground font-medium bg-surface-hover transition-colors"
                >
                  {t('cancel') || 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={cashBoxSubmitting || !closeShiftActual}
className="flex-1 py-3 rounded-lg bg-danger text-white font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {cashBoxSubmitting ? '...' : (t('closeShift') || 'Close Shift')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
