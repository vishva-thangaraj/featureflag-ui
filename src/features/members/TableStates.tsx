import { Button } from '@/components/ui/button'

export function TableSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-9 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  )
}

export function TableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
      <p>{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
