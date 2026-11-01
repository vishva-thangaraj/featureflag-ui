import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isExpired, unrevokedKeysFor, useApiKeys, useRevokeApiKey, type ApiKey } from '@/features/api-keys/queries'
import { useFlagConfig } from '@/features/flags/queries'
import { fallbackMessage } from '@/lib/form-errors'
import { formatDate } from '@/lib/format'
import { isProtectedEnvironment, useDeleteEnvironment, type Environment } from './queries'

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'

const keysLabel = (count: number) => `${count} API key${count === 1 ? '' : 's'}`

interface DeleteEnvironmentDialogProps {
  environment: Environment
  onClose: () => void
}

/**
 * Never a dead end: while keys still read the environment the server refuses the delete, so the dialog
 * lists them with a way to revoke each, and Delete becomes available once none are left.
 */
export function DeleteEnvironmentDialog({ environment, onClose }: DeleteEnvironmentDialogProps) {
  const keys = useApiKeys()
  const config = useFlagConfig(environment.name)
  const deleteEnvironment = useDeleteEnvironment()
  const [typedName, setTypedName] = useState('')
  const [failure, setFailure] = useState<string>()
  const confirmId = useId()

  const blocking = keys.data ? unrevokedKeysFor(keys.data, environment.name) : []
  const isProtected = isProtectedEnvironment(environment.name)
  const ready =
    keys.isSuccess && blocking.length === 0 && (!isProtected || typedName === environment.name) && !deleteEnvironment.isPending

  async function confirmDelete() {
    setFailure(undefined)
    try {
      await deleteEnvironment.mutateAsync(environment.id)
      toast.success(`${environment.name} deleted`)
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // A key was issued after this dialog loaded its list; the refetch puts it in front of the user.
        await keys.refetch()
      } else {
        setFailure(fallbackMessage(error))
      }
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocking.length > 0
              ? `Revoke ${keysLabel(blocking.length)} before deleting ${environment.name}`
              : `Delete ${environment.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocking.length === 1
              ? `This key still reads ${environment.name}. Revoke it first, so the app using it stops on purpose rather than by surprise.`
              : blocking.length > 1
                ? `These keys still read ${environment.name}. Revoke them first, so the apps using them stop on purpose rather than by surprise.`
                : "This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {keys.isPending && <p role="status" className="text-sm text-muted-foreground">Checking API keys…</p>}
        {blocking.length > 0 && (
          <ul className="flex flex-col gap-2">
            {blocking.map((key) => (
              <BlockingKey key={key.id} apiKey={key} />
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2.5 text-sm">
          <Consequences environmentName={environment.name} flagsSetUp={config.data?.flags.length} />
          <span className="text-muted-foreground">The flags themselves stay, and so do the other environments.</span>
        </div>

        {isProtected && blocking.length === 0 && keys.isSuccess && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={confirmId}>
              Type <code className="font-mono">{environment.name}</code> to confirm
            </Label>
            <Input
              id={confirmId}
              className="h-9 font-mono"
              autoComplete="off"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
            />
          </div>
        )}

        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}

        <AlertDialogFooter>
          {blocking.length > 0 && (
            <p id="delete-blocked" className="text-sm text-muted-foreground sm:mr-auto sm:self-center">
              {blocking.length === 1 ? 'Revoke the key above to continue.' : 'Revoke the keys above to continue.'}
            </p>
          )}
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            className={DANGER}
            disabled={!ready}
            aria-describedby={blocking.length > 0 ? 'delete-blocked' : undefined}
            onClick={() => void confirmDelete()}
          >
            {deleteEnvironment.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Delete {environment.name}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Consequences({ environmentName, flagsSetUp }: { environmentName: string; flagsSetUp: number | undefined }) {
  if (flagsSetUp === undefined) {
    return <span>Counting what goes with it…</span>
  }
  if (flagsSetUp === 0) {
    return <span>No flags are set up in {environmentName} yet, so nothing else goes with it.</span>
  }
  return (
    <span>
      {flagsSetUp} flag{flagsSetUp === 1 ? ' is' : 's are'} set up in {environmentName}. Deleting it removes their
      on/off state, rollout, targeting rules and user overrides there.
    </span>
  )
}

/** Revoking is irreversible too, so it takes a second click. */
function BlockingKey({ apiKey }: { apiKey: ApiKey }) {
  const revoke = useRevokeApiKey()
  const [confirming, setConfirming] = useState(false)

  function revokeKey() {
    revoke.mutate(apiKey.id, {
      onError: (error) => {
        setConfirming(false)
        toast.error(`Couldn't revoke ${apiKey.name}. ${fallbackMessage(error)}`)
      },
    })
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{apiKey.name}</span>
          <span className="text-sm text-muted-foreground">
            <code className="font-mono text-xs">{apiKey.prefix}…</code> ·{' '}
            {isExpired(apiKey)
              ? 'expired, but not revoked'
              : apiKey.lastUsedAt
                ? `last used around ${formatDate(apiKey.lastUsedAt)}`
                : 'never used'}
          </span>
        </div>
        {confirming ? (
          <Button size="sm" className={DANGER} disabled={revoke.isPending} onClick={revokeKey}>
            {revoke.isPending && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
            Confirm revoke
          </Button>
        ) : (
          <Button size="sm" variant="outline" aria-label={`Revoke ${apiKey.name}`} onClick={() => setConfirming(true)}>
            Revoke
          </Button>
        )}
      </div>
      {confirming && (
        <p role="status" className="text-sm text-destructive">
          Apps using this key stop receiving flags on their next request.
        </p>
      )}
    </li>
  )
}
