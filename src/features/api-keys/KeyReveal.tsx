import { useEffect, useRef } from 'react'
import { TriangleAlert } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** The one time a key is visible. Nothing here keeps it: closing the dialog that shows this loses it. */
export function KeyReveal({ secret }: { secret: string }) {
  const curl = `curl -H "X-API-Key: ${secret}" ${window.location.origin}/api/v1/sdk/config`
  const containerRef = useRef<HTMLDivElement>(null)

  // The step before took the focused control with it; start on the key's Copy button, not the dialog.
  useEffect(() => {
    containerRef.current?.querySelector('button')?.focus()
  }, [])

  return (
    <div ref={containerRef} className="flex min-w-0 flex-col gap-3">
      <p className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        This is the only time the key is shown. Only a hash of it is kept, so it can't be shown again.
      </p>
      <Copyable label="Key" value={secret} />
      <Copyable label="Try it" copyLabel="Command" value={curl} />
    </div>
  )
}

function Copyable({ label, copyLabel = label, value }: { label: string; copyLabel?: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-start gap-1 rounded-lg border bg-muted py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 py-1 font-mono text-[13px] break-all whitespace-pre-wrap">{value}</code>
        <CopyButton value={value} label={copyLabel} />
      </div>
    </div>
  )
}

interface CloseWithoutKeyAlertProps {
  open: boolean
  /** What closing leaves behind, and how to recover if the key wasn't stored. */
  detail: string
  onStay: () => void
  onClose: () => void
}

/** A warning, not a trap: closing before the key is stored asks once, and then lets go. */
export function CloseWithoutKeyAlert({ open, detail, onStay, onClose }: CloseWithoutKeyAlertProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onStay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You won't be able to see this key again. Close anyway?</AlertDialogTitle>
          <AlertDialogDescription>{detail}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onClose}>Close anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
