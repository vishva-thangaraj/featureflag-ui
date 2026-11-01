import { useEffect, useState } from 'react'

/** Whole seconds left, ticking down to 0. Start it with the setter, e.g. from a 429's Retry-After. */
export function useCountdown() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (seconds <= 0) {
      return
    }
    const timer = setTimeout(() => setSeconds((left) => left - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  return [seconds, setSeconds] as const
}
