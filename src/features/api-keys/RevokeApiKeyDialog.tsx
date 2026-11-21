import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { fallbackMessage } from '@/lib/form-errors'
import { formatLastUsed, useRevokeApiKey, type ApiKey } from './queries'

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'

export function RevokeApiKeyDialog({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const revoke = useRevokeApiKey()
  const [failure, setFailure] = useState<string>()

  async function confirmRevoke() {
    setFailure(undefined)
    try {
      await revoke.mutateAsync(apiKey.id)
      toast.success(`${apiKey.name} revoked`)
      onClose()
    } catch (error) {
      setFailure(fallbackMessage(error))
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {apiKey.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Apps using it stop receiving flags on their next request. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm">
          <code className="font-mono text-xs">{apiKey.prefix}…</code> reads{' '}
          <span className="font-mono text-xs">{apiKey.envName}</span>
          {apiKey.lastUsedAt ? `, last used ${formatLastUsed(apiKey.lastUsedAt)}.` : ' and has never been used.'}
        </p>
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button className={DANGER} disabled={revoke.isPending} onClick={() => void confirmRevoke()}>
            {revoke.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Revoke key
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
