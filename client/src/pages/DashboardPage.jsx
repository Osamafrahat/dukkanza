import { Card, Spinner } from '@heroui/react'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'
import { productsApi, ordersApi, reportsApi, suppliersApi, promotionsApi, expensesApi, accountingReportsApi, paymentsApi, bannersApi } from '../lib/api'
import { formatCurrency } from '../lib/utils'
import ClockWidget from '../components/attendance/ClockWidget'
import BannerCarousel from '../components/BannerCarousel'
import KpiCard from '../components/dashboard/KpiCard'
import SalesAnalytics from '../components/dashboard/SalesAnalytics'
import useSalesAnalytics from '../components/dashboard/useSalesAnalytics'
import {
  // Calendar and Star were once referenced below (HR Manager dashboard)
  // without being imported, which threw a ReferenceError and blanked the
  // page for any user with the HR_MANAGER role. react/jsx-no-undef now
  // makes that class of bug a build-blocking lint error.
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  ClipboardList,
  DollarSign,
  Package,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Star,
  Tag,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react'

export default function DashboardPage() {
  const { currentUser, hasPermission } = useUserStore()
  const { t, settings } = useAppStore()
  const [stats, setStats] = useState({
    todaySales: 0,
    todayOrders: 0,
    totalProducts: 0,
    lowStockCount: 0,
    totalSuppliers: 0,
    activePromotions: 0,
    recentOrders: [],
    lowStockProducts: [],
    topProducts: [],
    totalExpenses: 0,
    recentExpenses: [],
    recentPayments: [],
    totalInbound: 0,
    totalOutbound: 0,
    netCashFlow: 0,
    recentJournals: [],
    accountCount: 0,
  })
  const [loading, setLoading] = useState(true)
  const [banners, setBanners] = useState([])

  // 30-day window behind the analytics panel AND the Manager sales delta.
  // Both this hook and <SalesAnalytics /> share one cached request.
  const { analytics } = useSalesAnalytics()

  useEffect(() => {
    fetchDashboardData()
    bannersApi.getActive().then(({ data }) => setBanners(data || [])).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [])

  const fetchDashboardData = async () => {
    setLoading(true)
    try {
      const promises = []

      if (hasPermission(PERMISSIONS.REPORTS_VIEW) || hasPermission(PERMISSIONS.POS_ACCESS)) {
        promises.push(
          reportsApi.getSales({ range: 'today' }).catch(() => ({ data: {} })),
          ordersApi.getAll().catch(() => ({ data: [] }))
        )
      }

      if (hasPermission(PERMISSIONS.INVENTORY_VIEW)) {
        promises.push(
          productsApi.getAll().catch(() => ({ data: [] }))
        )
      }

      if (hasPermission(PERMISSIONS.SUPPLIERS_VIEW)) {
        promises.push(
          suppliersApi.getAll().catch(() => ({ data: [] }))
        )
      }

      if (hasPermission(PERMISSIONS.PROMOTIONS_VIEW)) {
        promises.push(
          promotionsApi.getAll().catch(() => ({ data: [] }))
        )
      }

      if (hasPermission(PERMISSIONS.ACCOUNTING_VIEW)) {
        promises.push(
          expensesApi.getAll({ limit: 10 }).catch(() => ({ data: [] })),
          paymentsApi.getAll({ limit: 10 }).catch(() => ({ data: [] })),
          accountingReportsApi.getTrialBalance().catch(() => ({ data: { accounts: [] } })),
        )
      }

      const results = await Promise.all(promises)
      let resultIndex = 0

      if (hasPermission(PERMISSIONS.REPORTS_VIEW) || hasPermission(PERMISSIONS.POS_ACCESS)) {
        const salesData = results[resultIndex]?.data || {}
        const orders = results[resultIndex + 1]?.data || []
        setStats(prev => ({
          ...prev,
          todaySales: salesData.totalSales || 0,
          todayOrders: salesData.totalOrders || 0,
          recentOrders: orders.slice(0, 5),
        }))
        resultIndex += 2
      }

      if (hasPermission(PERMISSIONS.INVENTORY_VIEW)) {
        const productsRes = results[resultIndex]
        const products = productsRes?.data?.data || productsRes?.data || []
        const lowStock = products.filter(p => p.stock_quantity <= (p.low_stock_threshold || 10))
        setStats(prev => ({
          ...prev,
          totalProducts: products.length,
          lowStockCount: lowStock.length,
          lowStockProducts: lowStock.slice(0, 5),
        }))
        resultIndex += 1
      }

      if (hasPermission(PERMISSIONS.SUPPLIERS_VIEW)) {
        const suppliers = results[resultIndex]?.data || []
        setStats(prev => ({ ...prev, totalSuppliers: suppliers.length }))
        resultIndex += 1
      }

      if (hasPermission(PERMISSIONS.PROMOTIONS_VIEW)) {
        const promos = results[resultIndex]?.data || []
        const active = promos.filter(p => p.is_active && new Date(p.end_date) > new Date())
        setStats(prev => ({ ...prev, activePromotions: active.length }))
        resultIndex += 1
      }

      if (hasPermission(PERMISSIONS.ACCOUNTING_VIEW)) {
        const expenses = results[resultIndex]?.data || []
        const payments = results[resultIndex + 1]?.data?.data || []
        const trialBalance = results[resultIndex + 2]?.data || { accounts: [] }
        const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0)
        const totalInbound = payments.filter(p => p.payment_type === 'inbound').reduce((sum, p) => sum + (p.amount || 0), 0)
        const totalOutbound = payments.filter(p => p.payment_type === 'outbound').reduce((sum, p) => sum + (p.amount || 0), 0)
        setStats(prev => ({
          ...prev,
          totalExpenses,
          recentExpenses: Array.isArray(expenses) ? expenses.slice(0, 5) : [],
          recentPayments: Array.isArray(payments) ? payments.slice(0, 5) : [],
          totalInbound,
          totalOutbound,
          netCashFlow: totalInbound - totalOutbound,
          accountCount: trialBalance.accounts?.length || 0,
        }))
        resultIndex += 3
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    )
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return t('dashboard.goodMorning')
    if (hour < 18) return t('dashboard.goodAfternoon')
    return t('dashboard.goodEvening')
  }

  const role = currentUser?.role
  const isManager = role === 'MANAGER'
  const isSalesManager = role === 'SALES_MANAGER'
  const isCashier = role === 'CASHIER'
  const isInventoryClerk = role === 'INVENTORY_CLERK'
  const isAccountant = role === 'ACCOUNTANT'
  const isHrManager = role === 'HR_MANAGER'

  return (
    <div className="space-y-6">
      {/* Banners */}
      <BannerCarousel banners={banners} />

      {/* Welcome Header — a tinted surface with an accent glow rather than a
          flat colour bar, so it reads as depth instead of a banner. */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/12 via-transparent to-success/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-accent opacity-20 blur-3xl"
        />
        <div className="relative">
          <h1 className="break-words text-xl font-bold text-foreground sm:text-2xl">
            {getGreeting()}, {currentUser?.fullName}!
          </h1>
          <p className="mt-1 truncate text-sm text-muted">
            {settings.storeName || t('layout.defaultStoreName')} — {ROLES_LABELS[role] || role}
          </p>
        </div>
      </div>

      {/* Clock In/Out for employees */}
      {!isManager && <ClockWidget />}

      {/* ===== MANAGER: Full Dashboard ===== */}
      {isManager && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Headline metric: animated currency, a 7-day sparkline and the
                week-over-week delta from the analytics window. */}
            <KpiCard
              icon={DollarSign}
              label={t('dashboard.todaysSales')}
              value={stats.todaySales}
              format={(n) => formatCurrency(n)}
              delta={analytics?.delta ?? null}
              deltaLabel={analytics ? t('dashboard.vsLastWeek') : undefined}
              spark={analytics?.spark || []}
              tone="green"
              href="/reports"
            />
            <StatCard icon={ShoppingBag} label={t('dashboard.todaysOrders')} value={stats.todayOrders} color="blue" href="/reports" />
            <StatCard icon={Package} label={t('dashboard.totalProducts')} value={stats.totalProducts} color="purple" href="/inventory" />
            <StatCard icon={AlertTriangle} label={t('dashboard.lowStockItems')} value={stats.lowStockCount} color={stats.lowStockCount > 0 ? 'red' : 'gray'} href="/inventory" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Truck} label={t('dashboard.totalSuppliers')} value={stats.totalSuppliers} color="amber" href="/suppliers" />
            <StatCard icon={Tag} label={t('dashboard.activePromotions')} value={stats.activePromotions} color="pink" href="/promotions" />
            <StatCard icon={Users} label={t('dashboard.teamMembers')} value={t('dashboard.viewAll')} color="indigo" href="/users" />
          </div>
          <SalesAnalytics />
          <QuickActions showAll />
          <ManagerDashboard stats={stats} t={t} />
        </>
      )}

      {/* ===== SALES MANAGER: Sales & Customers Focus ===== */}
      {isSalesManager && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={DollarSign} label={t('dashboard.todaysSales')} value={formatCurrency(stats.todaySales)} color="green" href="/reports" />
            <StatCard icon={ShoppingBag} label={t('dashboard.todaysOrders')} value={stats.todayOrders} color="blue" href="/reports" />
            <StatCard icon={Tag} label={t('dashboard.activePromotions')} value={stats.activePromotions} color="pink" href="/promotions" />
            <StatCard icon={Package} label={t('dashboard.totalProducts')} value={stats.totalProducts} color="purple" href="/inventory" />
          </div>
          <SalesAnalytics />
          <QuickActions showPOS showPromotions showCustomers />
          <SalesDashboard stats={stats} t={t} />
        </>
      )}

      {/* ===== CASHIER: POS Focus ===== */}
      {isCashier && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard icon={DollarSign} label={t('dashboard.todaysSales')} value={formatCurrency(stats.todaySales)} color="green" href="/reports" />
            <StatCard icon={ShoppingBag} label={t('dashboard.todaysOrders')} value={stats.todayOrders} color="blue" href="/reports" />
          </div>
          <SalesAnalytics />
          <QuickActions showPOS={false} />
          <CashierDashboard stats={stats} t={t} />
        </>
      )}

      {/* ===== INVENTORY CLERK: Inventory Focus ===== */}
      {isInventoryClerk && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard icon={Package} label={t('dashboard.totalProducts')} value={stats.totalProducts} color="purple" href="/inventory" />
            <StatCard icon={AlertTriangle} label={t('dashboard.lowStockItems')} value={stats.lowStockCount} color={stats.lowStockCount > 0 ? 'red' : 'gray'} href="/inventory" />
            <StatCard icon={Truck} label={t('dashboard.totalSuppliers')} value={stats.totalSuppliers} color="amber" href="/suppliers" />
          </div>
          <SalesAnalytics />
          <QuickActions showInventory showSuppliers />
          <InventoryDashboard stats={stats} t={t} />
        </>
      )}

      {/* ===== HR MANAGER: HR Focus ===== */}
      {isHrManager && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard icon={Users} label={t('dashboard.teamMembers')} value={t('dashboard.viewAll')} color="indigo" href="/employees" />
            <StatCard icon={Calendar} label={t('dashboard.attendance')} value={t('dashboard.viewAll')} color="blue" href="/attendance" />
            <StatCard icon={Star} label={t('dashboard.performance')} value={t('dashboard.viewAll')} color="purple" href="/performance" />
          </div>
          <SalesAnalytics />
          <QuickActions showHR />
        </>
      )}

      {/* ===== ACCOUNTANT: Financial Focus ===== */}
      {isAccountant && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={DollarSign} label={t('dashboard.totalInbound')} value={formatCurrency(stats.totalInbound)} color="green" href="/accounting/payments" />
            <StatCard icon={DollarSign} label={t('dashboard.totalOutbound')} value={formatCurrency(stats.totalOutbound)} color="red" href="/accounting/payments" />
            <StatCard icon={TrendingUp} label={t('dashboard.netCashFlow')} value={formatCurrency(stats.netCashFlow)} color={stats.netCashFlow >= 0 ? 'green' : 'red'} href="/accounting/payments" />
            <StatCard icon={DollarSign} label={t('dashboard.totalExpenses')} value={formatCurrency(stats.totalExpenses)} color="amber" href="/expenses" />
          </div>
          <SalesAnalytics />
          <AccountantQuickActions />
          <AccountantDashboard stats={stats} t={t} />
        </>
      )}
    </div>
  )
}

const ROLES_LABELS = {
  MANAGER: 'Manager / مدير',
  SALES_MANAGER: 'Sales Manager / مدير المبيعات',
  CASHIER: 'Cashier / كاشير',
  INVENTORY_CLERK: 'Inventory Clerk /موظف مخزون',
  ACCOUNTANT: 'Accountant / محاسب',
  HR_MANAGER: 'HR Manager / مدير الموارد البشرية',
}

// ===== Manager Dashboard =====
function ManagerDashboard({ stats, t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {stats.recentOrders.length > 0 && <RecentOrders orders={stats.recentOrders} t={t} />}
      {stats.lowStockProducts.length > 0 && <LowStockAlert products={stats.lowStockProducts} t={t} />}
      {stats.recentOrders.length === 0 && stats.lowStockProducts.length === 0 && (
        <Card className="col-span-2 gap-0 rounded-xl border border-border shadow-sm p-6 md:p-12 text-center">
          <BarChart3 className="w-16 h-16 mx-auto text-muted mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">{t('dashboard.welcomeTitle')}</h3>
          <p className="text-muted">{t('dashboard.welcomeMessage')}</p>
        </Card>
      )}
    </div>
  )
}

// ===== Sales Dashboard =====
function SalesDashboard({ stats, t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {stats.recentOrders.length > 0 && <RecentOrders orders={stats.recentOrders} t={t} />}
      {stats.lowStockProducts.length > 0 && <LowStockAlert products={stats.lowStockProducts} t={t} />}
      {stats.recentOrders.length === 0 && stats.lowStockProducts.length === 0 && (
        <Card className="col-span-2 gap-0 rounded-xl border border-border shadow-sm p-6 md:p-12 text-center">
          <TrendingUp className="w-16 h-16 mx-auto text-muted mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">{t('dashboard.welcomeTitle')}</h3>
          <p className="text-muted">{t('dashboard.welcomeMessage')}</p>
        </Card>
      )}
    </div>
  )
}

// ===== Cashier Dashboard =====
function CashierDashboard({ stats, t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {stats.recentOrders.length > 0 && <RecentOrders orders={stats.recentOrders} t={t} />}
      {stats.recentOrders.length === 0 && (
        <Card className="col-span-2 gap-0 rounded-xl border border-border shadow-sm p-6 md:p-12 text-center">
          <ShoppingCart className="w-16 h-16 mx-auto text-muted mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">{t('dashboard.startSelling')}</h3>
          <p className="text-muted">{t('dashboard.startSellingDesc')}</p>
        </Card>
      )}
    </div>
  )
}

// ===== Inventory Dashboard =====
function InventoryDashboard({ stats, t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {stats.lowStockProducts.length > 0 && <LowStockAlert products={stats.lowStockProducts} t={t} />}
      {stats.lowStockProducts.length === 0 && (
        <Card className="col-span-2 gap-0 rounded-xl border border-border shadow-sm p-6 md:p-12 text-center">
          <Package className="w-16 h-16 mx-auto text-muted mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">{t('dashboard.manageInventory')}</h3>
          <p className="text-muted">{t('dashboard.manageInventoryDesc')}</p>
        </Card>
      )}
    </div>
  )
}

// ===== Shared Components =====
function AccountantQuickActions() {
  const { t } = useAppStore()

  const actions = [
{label: t('dashboard.chartOfAccounts'),icon: ClipboardList,href:'/accounting/accounts',color:'bg-accent hover:bg-indigo-700'},
{label: t('dashboard.journalEntries'),icon: BookOpen,href:'/accounting/journals',color:'bg-purple-600 hover:bg-purple-700'},
{label: t('dashboard.viewPayments'),icon: DollarSign,href:'/accounting/payments',color:'bg-success hover:bg-green-700'},
{label: t('dashboard.manageExpenses'),icon: Receipt,href:'/expenses',color:'bg-warning hover:bg-amber-700'},
{label: t('dashboard.viewReports'),icon: BarChart3,href:'/accounting/reports',color:'bg-accent hover:bg-blue-700'},
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {actions.map((action) => (
        <Link
          key={action.href}
          to={action.href}
className={`${action.color} text-white rounded-xl p-4 flex items-center gap-3 transition-colors`}
        >
          <action.icon className="w-6 h-6" />
          <div>
            <p className="font-semibold text-sm">{action.label}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}

function AccountantDashboard({ stats, t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {stats.recentPayments.length > 0 && (
        <Card className="gap-0 rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base sm:text-lg font-semibold truncate mr-3">{t('dashboard.recentPayments')}</h3>
            <Link to="/accounting/payments" className="text-accent hover:text-accent/80 text-sm flex items-center gap-1 shrink-0">
              {t('dashboard.viewAll')} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {stats.recentPayments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{payment.description || payment.reference || `Payment #${payment.id}`}</p>
                  <p className="text-sm text-muted">
                    {new Date(payment.created_at || payment.date).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right shrink-0 pl-3">
                  <p className={`font-semibold whitespace-nowrap ${payment.type === 'inbound' ? 'text-success' : 'text-danger'}`}>
                    {payment.type === 'inbound' ? '+' : '-'}{formatCurrency(payment.amount)}
                  </p>
                  <p className="text-xs text-muted capitalize">
                    {payment.type}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {stats.recentExpenses.length > 0 && (
        <Card className="gap-0 rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base sm:text-lg font-semibold truncate mr-3">{t('dashboard.recentExpenses')}</h3>
            <Link to="/expenses" className="text-accent hover:text-accent/80 text-sm flex items-center gap-1 shrink-0">
              {t('dashboard.viewAll')} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {stats.recentExpenses.map((expense) => (
              <div key={expense.id} className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{expense.description || expense.category}</p>
                  <p className="text-sm text-muted truncate">
                    {expense.category} — {new Date(expense.created_at || expense.date).toLocaleDateString()}
                  </p>
                </div>
                <span className="font-semibold text-danger whitespace-nowrap shrink-0 pl-3">-{formatCurrency(expense.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {stats.recentPayments.length === 0 && stats.recentExpenses.length === 0 && (
        <Card className="col-span-2 gap-0 rounded-xl border border-border shadow-sm p-6 md:p-12 text-center">
          <DollarSign className="w-16 h-16 mx-auto text-muted mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">{t('dashboard.welcomeTitle')}</h3>
          <p className="text-muted">{t('dashboard.welcomeMessage')}</p>
        </Card>
      )}
    </div>
  )
}

// Adapter over the modern KpiCard. The role layouts pass `value` as either a
// raw number (which animates) or a pre-formatted string such as a currency
// or a translation (rendered verbatim — there is nothing to interpolate).
// `color` keeps the exact icon-tile palette the old card used.
function StatCard({ icon: Icon, label, value, color, href }) {
  const isNumeric = typeof value === 'number'

  return (
    <KpiCard
      label={label}
      icon={Icon}
      href={href}
      tone={color || 'accent'}
      value={isNumeric ? value : 0}
      displayValue={isNumeric ? undefined : String(value ?? '')}
    />
  )
}

function QuickActions({ showAll, showPOS, showInventory, showSuppliers, showPromotions }) {
  const { hasPermission } = useUserStore()
  const { t } = useAppStore()

  const actions = []

  if (showAll || showPOS || hasPermission(PERMISSIONS.POS_ACCESS)) {
    actions.push({
      label: t('dashboard.startSelling'),
      description: t('dashboard.startSellingDesc'),
      icon: ShoppingCart,
      href: '/pos',
color:'bg-accent hover:bg-primary-700',
    })
  }

  if (showAll || showInventory || hasPermission(PERMISSIONS.INVENTORY_EDIT)) {
    actions.push({
      label: t('dashboard.manageInventory'),
      description: t('dashboard.manageInventoryDesc'),
      icon: Package,
      href: '/inventory',
color:'bg-success hover:bg-green-700',
    })
  }

  if (showAll || showSuppliers || hasPermission(PERMISSIONS.SUPPLIERS_EDIT)) {
    actions.push({
      label: t('dashboard.addSupplier'),
      description: t('dashboard.addSupplierDesc'),
      icon: Truck,
      href: '/suppliers',
color:'bg-warning hover:bg-amber-700',
    })
  }

  if (showAll || showPromotions || hasPermission(PERMISSIONS.PROMOTIONS_EDIT)) {
    actions.push({
      label: t('dashboard.createPromotion'),
      description: t('dashboard.createPromotionDesc'),
      icon: Tag,
      href: '/promotions',
      color: 'bg-pink-600 hover:bg-pink-700',
    })
  }

  if (actions.length === 0) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {actions.map((action) => (
        <Link
          key={action.href}
          to={action.href}
className={`${action.color} text-white rounded-xl p-4 flex items-center gap-3 transition-colors`}
        >
          <action.icon className="w-6 h-6" />
          <div>
            <p className="font-semibold">{action.label}</p>
<p className="text-sm text-white/80 line-clamp-2">{action.description}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}

function RecentOrders({ orders, t }) {
  return (
    <Card className="gap-0 rounded-xl border border-border shadow-sm p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-semibold truncate mr-3">{t('dashboard.recentOrders')}</h3>
        <Link to="/reports" className="text-accent hover:text-accent/80 text-sm flex items-center gap-1 shrink-0">
          {t('dashboard.viewAll')} <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{order.order_number}</p>
              <p className="text-sm text-muted">
                {new Date(order.created_at).toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{formatCurrency(order.total)}</p>
              <p className="text-xs text-muted capitalize">
                {order.payment_method}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function LowStockAlert({ products, t }) {
  return (
    <Card className="gap-0 rounded-xl border border-border shadow-sm bg-warning-soft p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2 text-warning-soft-foreground truncate mr-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {t('dashboard.lowStockAlert')}
        </h3>
        <Link to="/inventory" className="text-accent hover:text-accent/80 text-sm flex items-center gap-1 shrink-0">
          {t('dashboard.viewAll')} <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="space-y-3">
        {products.map((product) => (
          <div key={product.id} className="flex items-center justify-between p-3 bg-warning-soft rounded-lg">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{product.name}</p>
              <p className="text-sm text-muted">
                {t('dashboard.threshold')}: {product.low_stock_threshold}
              </p>
            </div>
            <span className="text-lg font-bold text-warning-soft-foreground">
              {product.stock_quantity} {t('dashboard.left')}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
