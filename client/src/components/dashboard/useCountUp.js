import { useEffect, useRef, useState } from 'react'

// Animate a numeric value from its previous reading to the new one so KPI
// cards tick up instead of snapping — the detail that makes a dashboard
// feel live rather than static.
//
// Deliberately skips the animation when the user asks for reduced motion,
// and when the value is unchanged (a background refetch must not replay the
// count-up on every poll).
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(() => Number(target) || 0)
  const fromRef = useRef(Number(target) || 0)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    const to = Number.isFinite(Number(target)) ? Number(target) : 0

    if (from === to || prefersReducedMotion()) {
      fromRef.current = to
      setValue(to)
      return undefined
    }

    const start = performance.now()
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      // easeOutCubic: fast at first, settling gently onto the final figure.
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(from + (to - from) * eased)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return value
}
