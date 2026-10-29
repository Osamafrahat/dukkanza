import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import useCountUp from './useCountUp'

// Visual treatments per metric kind. The soft background + saturated
// foreground keeps the icon legible without competing with the value.
// Keys beyond the semantic four mirror the palette the page already used,
// so existing cards keep their exact colours.
const TONES = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  green: 'bg-success-soft text-success',
  blue: 'bg-accent-soft text-accent-soft-foreground',
  indigo: 'bg-accent-soft text-accent-soft-foreground',
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warning-soft text-warning',
  purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600',
  pink: 'bg-pink-100 dark:bg-pink-900/30 text-pink-600',
  gray: 'bg-surface-tertiary text-muted',
}

// Chart colour per tone. CSS variables with hex fallbacks: the vars make the
// sparkline follow the active theme (light/dark) automatically, and the
// fallback covers the case where a token is missing.
const STROKE = {
  accent: 'var(--accent, #3b82f6)',
  success: 'var(--success, #10b981)',
  warning: 'var(--warning, #f59e0b)',
  danger: 'var(--danger, #ef4444)',
  green: 'var(--success, #10b981)',
  blue: 'var(--accent, #3b82f6)',
  indigo: 'var(--accent, #3b82f6)',
  red: 'var(--danger, #ef4444)',
  amber: 'var(--warning, #f59e0b)',
  purple: '#a855f7',
  pink: '#ec4899',
  gray: 'var(--muted, #9ca3af)',
}

/**
 * A headline metric: tinted icon, an animated figure, an optional
 * week-over-week delta chip and a sparkline of the underlying trend.
 *
 * Pass EITHER `value` (numeric — animated up from its last reading) or
 * `displayValue` (a pre-formatted string such as "EGP 1,234.00", rendered
 * as-is since there is nothing to interpolate).
 *
 * @param {number} value  numeric target
 * @param {string} displayValue  pre-rendered figure, skips animation
 * @param {(n: number) => string} format  renders the animated figure
 * @param {number|null} delta  percentage change vs the comparison period
 * @param {number[]} spark  recent readings, oldest first
 */
export default function KpiCard({
  label,
  value,
  displayValue,
  format = (n) => Math.round(n).toLocaleString(),
  delta = null,
  deltaLabel,
  spark = [],
  icon: Icon,
  tone = 'accent',
  href,
}) {
  const gradientId = useId()
  const isStatic = displayValue !== undefined && displayValue !== null
  const animated = useCountUp(isStatic ? 0 : value)

  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  const up = hasDelta && delta >= 0
  // A flat 0% is neither good nor bad — render it neutrally.
  const deltaTone = !hasDelta || delta === 0
    ? 'bg-surface-secondary text-muted'
    : up
      ? 'bg-success-soft text-success'
      : 'bg-danger-soft text-danger'

  const sparkData = spark.map((v, i) => ({ i, v }))
  // In-app destinations go through Link so the card keeps client-side
  // navigation — a plain <a> would full-reload the SPA.
  const internal = typeof href === 'string' && href.startsWith('/')
  const Card = internal ? Link : href ? 'a' : 'div'

  return (
    <Card
      {...(href ? (internal ? { to: href } : { href }) : {})}
      className="relative block overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-accent/40"
    >
      {/* Soft radial wash in the card's top-right — the "modern" tell that
          flat cards lack. Purely decorative, so it stays behind content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full opacity-[0.13] blur-2xl"
        style={{ background: STROKE[tone] }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
            {isStatic ? displayValue : format(animated)}
          </p>
        </div>

        {Icon && (
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${TONES[tone] || TONES.accent}`}>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>

      <div className="relative mt-3 flex items-center gap-3">
        {hasDelta && (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${deltaTone}`}>
            {/* Text arrows rather than an icon: they survive print, colour
                blindness and screen readers reading the direction aloud. */}
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {deltaLabel && (
          <span className="truncate text-xs text-muted">{deltaLabel}</span>
        )}
      </div>

      {sparkData.length > 1 && (
        <div className="relative mt-3 h-10 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STROKE[tone]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={STROKE[tone]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={STROKE[tone]}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
