import { useEffect, useState } from 'react'

/** Shown only after 300 ms, so a fast load never flashes a placeholder. */
export function PageSkeleton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex min-h-svh items-center justify-center">
      {visible && <div className="h-1.5 w-32 animate-pulse rounded-full bg-muted-foreground/20" />}
    </div>
  )
}
