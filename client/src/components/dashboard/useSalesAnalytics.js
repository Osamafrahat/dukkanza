import { useCallback, useEffect, useMemo, useState } from 'react'
import { reportsApi } from '../../lib/api'
import { useUserStore } from '../../stores/userStore'

// In-flight / recently-resolved cache. The dashboard mounts one analytics
// block, but React StrictMode double-invokes effects in development and a
// role switch remounts the tree — this keeps that to a single request.
const cache = new Map()
const CACHE_TTL = 60_000

function fetchWindow(range, tenantId) {
  const key = `${tenantId ?? 'me'}:${range}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data)

  const request = reportsApi
    .getSales({ range })
    .then((res) => {
      cache.set(key, { at: Date.now(), data: res.data })
      return res.data
    })
    .catch((err) => {
      // A failed analytics fetch must not take the dashboard down — the
      // caller renders without charts instead.
      cache.delete(key)
      throw err
    })

  // Cache the promise itself so concurrent mounts share one request.
  cache.set(key, { at: Date.now(), data: request })
  return request
}

const sum = (values) => values.reduce((total, v) => total + (Number(v) || 0), 0)

/**
 * Sales analytics for the dashboard: a 30-day window broken into a trend
 * series, a week-over-week comparison, top products and the hourly
 * distribution. All derived from ONE request to /reports/sales.
 *
 * `dailySales` from the server covers the requested range, so the
 * week-over-week delta is computed by splitting the tail (this week) from
 * the slice before it (last week) — no second round trip.
 */
export default function useSalesAnalytics(range = 'month') {
  const tenantId = useUserStore((s) => s.user?.tenant_id)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchWindow(range, tenantId)
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [range, tenantId])

  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => load(), [load, reloadKey])

  const analytics = useMemo(() => {
    if (!data) return null

    const daily = (data.dailySales || []).map((d) => ({
      ...d,
      label: d.date?.slice(8) + '/' + d.date?.slice(5, 7),
    }))

    const thisWeek = sum(daily.slice(-7).map((d) => d.sales))
    // The 7 days immediately before this week. An empty previous period
    // has no meaningful percentage, so delta stays null rather than "∞".
    const previousWeekDays = daily.slice(-14, -7)
    const lastWeek = sum(previousWeekDays.map((d) => d.sales))
    const delta =
      lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null

    const hourly = data.hourlySales || []
    const peakHour = hourly.reduce(
      (best, h) => (h.sales > (best?.sales ?? -1) ? h : best),
      null,
    )

    return {
      daily,
      thisWeek,
      lastWeek,
      delta,
      spark: daily.slice(-7).map((d) => d.sales),
      topProducts: (data.topProducts || []).slice(0, 5),
      hourly,
      peakHour,
      avgOrderValue: data.avgOrderValue || 0,
      itemsSold: data.itemsSold || 0,
      totalSales: data.totalSales || 0,
      totalOrders: data.totalOrders || 0,
    }
  }, [data])

  return { analytics, loading, error, reload: () => setReloadKey((k) => k + 1) }
}
