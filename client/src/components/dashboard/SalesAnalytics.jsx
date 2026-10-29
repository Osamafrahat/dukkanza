import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Clock, Package, TrendingUp } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, getLocale } from '../../lib/utils'
import useSalesAnalytics from './useSalesAnalytics'

// Theme-aware chart colours (CSS variable, hex fallback) so the panel
// reads correctly in both light and dark mode.
const ACCENT = 'var(--accent, #3b82f6)'
const ACCENT_SOFT = 'var(--accent-soft, #dbeafe)'
const MUTED_LINE = 'var(--border, #e5e7eb)'

const hourLabel = (h) => {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

// Recharts' built-in tooltip is unstyled and assumes a light background.
// This one follows the app's surface/border tokens.
function ChartTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="tabular-nums text-muted">
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
            style={{ background: entry.color || ACCENT }}
          />
          {format ? format(entry.value) : entry.value?.toLocaleString?.() ?? entry.value}
        </p>
      ))}
    </div>
  )
}

function Panel({ icon: Icon, title, children, action }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {Icon && <Icon className="h-4 w-4 text-accent" />}
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

/**
 * The dashboard's analytics core: a revenue trend, a ranked top-products
 * list and the hourly sales distribution — all from one /reports/sales
 * call, which the page already made for its headline totals.
 */
export default function SalesAnalytics() {
  const { t, language } = useAppStore()
  const locale = getLocale(language)
  const [range, setRange] = useState('month')
  const { analytics, loading } = useSalesAnalytics(range)

  const money = (v) => formatCurrency(v || 0, undefined, locale)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-foreground">
          {t('dashboard.analytics') || 'Analytics'}
        </h2>
        {/* Range toggle — switching refetches through the hook. */}
        <div className="inline-flex rounded-xl border border-border bg-surface p-1">
          {[
            { key: 'week', label: t('dashboard.last7Days') || '7 days' },
            { key: 'month', label: t('dashboard.last30Days') || '30 days' },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRange(option.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === option.key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !analytics ? (
        <div className="grid gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-2xl border border-border bg-surface-secondary"
            />
          ))}
        </div>
      ) : analytics ? (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Revenue trend — spans two columns, the panel's anchor. */}
          <div className="lg:col-span-2">
            <Panel
              icon={TrendingUp}
              title={t('dashboard.revenueTrend') || 'Revenue trend'}
              action={
                <span className="text-xs font-semibold tabular-nums text-success">
                  {money(analytics.totalSales)}
                </span>
              }
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={analytics.daily}
                    margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
                  >
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={MUTED_LINE} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--muted, #9ca3af)' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--muted, #9ca3af)' }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                    />
                    <Tooltip content={<ChartTooltip format={money} />} />
                    <Area
                      type="monotone"
                      dataKey="sales"
                      name={t('dashboard.revenue') || 'Revenue'}
                      stroke={ACCENT}
                      strokeWidth={2.5}
                      fill="url(#revenueFill)"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          {/* Top products — ranked bars. */}
          <Panel icon={Package} title={t('dashboard.topProducts') || 'Top products'}>
            {analytics.topProducts.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">
                {t('dashboard.noDataYet') || 'No sales yet'}
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  {/* LayoutY with negative width is Recharts' horizontal-bar
                      idiom; the category axis is the product name. */}
                  <BarChart
                    data={analytics.topProducts}
                    layout="vertical"
                    margin={{ top: 0, right: 8, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={MUTED_LINE} horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={96}
                      tick={{ fontSize: 11, fill: 'var(--muted, #9ca3af)' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(name) =>
                        name.length > 14 ? `${name.slice(0, 13)}…` : name
                      }
                    />
                    <Tooltip content={<ChartTooltip format={money} />} cursor={{ fill: ACCENT_SOFT, opacity: 0.5 }} />
                    <Bar
                      dataKey="revenue"
                      name={t('dashboard.revenue') || 'Revenue'}
                      fill={ACCENT}
                      radius={[0, 6, 6, 0]}
                      barSize={14}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          {/* Hourly distribution — busiest hours rise to the top in accent. */}
          <div className="lg:col-span-3">
            <Panel
              icon={Clock}
              title={t('dashboard.hourlyActivity') || 'Sales by hour'}
              action={
                analytics.peakHour ? (
                  <span className="text-xs text-muted">
                    {t('dashboard.peakHour') || 'Peak'}:{' '}
                    <span className="font-semibold text-foreground">
                      {hourLabel(analytics.peakHour.hour)}
                    </span>
                  </span>
                ) : null
              }
            >
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.hourly} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={MUTED_LINE} vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 10, fill: 'var(--muted, #9ca3af)' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={hourLabel}
                      interval={2}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--muted, #9ca3af)' }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                    />
                    <Tooltip content={<ChartTooltip format={money} />} cursor={{ fill: ACCENT_SOFT, opacity: 0.4 }} />
                    <Bar dataKey="sales" name={t('dashboard.revenue') || 'Revenue'} radius={[4, 4, 0, 0]}>
                      {/* Highlight the peak hour so the insight reads at a
                          glance instead of requiring a hover. */}
                      {analytics.hourly.map((h) => (
                        <Cell
                          key={h.hour}
                          fill={h.hour === analytics.peakHour?.hour ? ACCENT : 'var(--border, #d1d5db)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                <BarChart3 className="h-3.5 w-3.5" />
                {t('dashboard.avgOrderValue') || 'Avg order'}:{' '}
                <span className="font-semibold text-foreground">{money(analytics.avgOrderValue)}</span>
                <span className="mx-1 text-border">•</span>
                {t('dashboard.itemsSold') || 'Items sold'}:{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {analytics.itemsSold.toLocaleString(locale)}
                </span>
              </p>
            </Panel>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          {t('dashboard.noDataYet') || 'No sales yet'}
        </div>
      )}
    </div>
  )
}
