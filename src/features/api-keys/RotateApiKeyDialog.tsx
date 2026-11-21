import { useEffect, useId, useRef, useState } from 'react'
import { Check, CircleCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fallbackMessage } from '@/lib/form-errors'
import { cn } from '@/lib/utils'
import { CreateKeyForm } from './CreateKeyForm'
import { CloseWithoutKeyAlert, KeyReveal } from './KeyReveal'
import {
  formatLastUsed,
  rotatedName,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKey,
  type CreatedApiKey,
} from './queries'

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'
const POLL_INTERVAL = 15_000

type Step = 'create' | 'deploy' | 'revoke'

const STEPS: { step: Step; label: string }[] = [
  { step: 'create', label: 'Create the replacement' },
  { step: 'deploy', label: 'Deploy it' },
  { step: 'revoke', label: 'Revoke the old key' },
]

/**
 * Revoking takes effect on the next request, so revoking first is an outage. This order makes the safe
 * path the only one: the old key can be revoked here only after the new one has been seen in use.
 */
export function RotateApiKeyDialog({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const [step, setStep] = useState<Step>('create')
  const [replacement, setReplacement] = useState<CreatedApiKey>()
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [failure, setFailure] = useState<string>()
  const createKey = useCreateApiKey()
  const revoke = useRevokeApiKey()
  const statusId = useId()
  const continueRef = useRef<HTMLButtonElement>(null)

  const replacementId = replacement?.apiKey.id
  const keys = useApiKeys({
    refetchInterval: (list) =>
      step === 'deploy' && !list?.find((key) => key.id === replacementId)?.lastUsedAt ? POLL_INTERVAL : false,
  })
  const seenAt = keys.data?.find((key) => key.id === replacementId)?.lastUsedAt
  const oldLastUsedAt = (keys.data?.find((key) => key.id === apiKey.id) ?? apiKey).lastUsedAt

  // "Check now" goes once the key is seen; if it had focus, focus would otherwise fall to the dialog itself.
  useEffect(() => {
    const active = document.activeElement
    if (seenAt && (active === document.body || active?.getAttribute('role') === 'dialog')) {
      continueRef.current?.focus()
    }
  }, [seenAt])

  function requestClose() {
    if (createKey.isPending) {
      return
    }
    if (step === 'deploy' && !seenAt) {
      setConfirmingClose(true)
    } else {
      onClose()
    }
  }

  async function revokeOldKey() {
    setFailure(undefined)
    try {
      await revoke.mutateAsync(apiKey.id)
      toast.success(`${apiKey.name} revoked. ${replacement?.apiKey.name} replaces it.`)
      onClose()
    } catch (error) {
      setFailure(fallbackMessage(error))
    }
  }

  const currentIndex = STEPS.findIndex((entry) => entry.step === step)

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Rotate {apiKey.name}</DialogTitle>
            <DialogDescription>
              {step === 'create'
                ? `${apiKey.name} keeps working until the last step, so nothing breaks while you switch.`
                : step === 'deploy'
                  ? `Deploy the new key everywhere ${apiKey.name} is used. Revoking waits until the new key has been seen.`
                  : 'The new key is in use. The old one can go.'}
            </DialogDescription>
          </DialogHeader>

          <ol aria-label="Steps" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {STEPS.map((entry, index) => (
              <li
                key={entry.step}
                aria-current={index === currentIndex ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5',
                  index === currentIndex ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border text-xs tabular-nums',
                    index === currentIndex && 'border-foreground',
                  )}
                >
                  {index < currentIndex ? <Check className="size-3" /> : index + 1}
                </span>
                {entry.label}
                {index < currentIndex && <span className="sr-only"> (done)</span>}
              </li>
            ))}
          </ol>

          {step === 'create' && (
            <CreateKeyForm
              createKey={createKey}
              fixedEnvName={apiKey.envName}
              defaultName={rotatedName(apiKey.name)}
              submitLabel="Create replacement"
              onCancel={onClose}
              onCreated={(created) => {
                setReplacement(created)
                setStep('deploy')
              }}
            />
          )}

          {step === 'deploy' && replacement && (
            <>
              <KeyReveal secret={replacement.key} />
              <div
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg px-3 py-2.5 text-sm',
                  seenAt ? 'bg-success-soft text-success' : 'bg-muted',
                )}
              >
                <p id={statusId} role="status" className="flex items-center gap-2 font-medium">
                  {seenAt ? (
                    <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
                  ) : (
                    <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                  )}
                  {seenAt ? `Seen ${formatLastUsed(seenAt)}` : "Waiting for the new key's first request"}
                </p>
                {!seenAt && (
                  <>
                    <span className="text-muted-foreground">
                      It can take up to five minutes to show here after an app first uses it.
                    </span>
                    <Button variant="link" className="h-auto p-0" onClick={() => void keys.refetch()}>
                      Check now
                    </Button>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={requestClose}>
                  Close
                </Button>
                <Button
                  ref={continueRef}
                  disabled={!seenAt}
                  aria-describedby={statusId}
                  onClick={() => setStep('revoke')}
                >
                  Continue
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 'revoke' && (
            <>
              <div className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm">
                <p className="font-medium">Revoke {apiKey.name}?</p>
                <p className="text-muted-foreground">
                  Apps using it stop receiving flags on their next request. This can't be undone.
                </p>
                <p className="text-muted-foreground">
                  {oldLastUsedAt
                    ? `It was last used ${formatLastUsed(oldLastUsedAt)}. Use is recorded at most every five minutes, so a recent time may be an app that hasn't switched yet.`
                    : 'It has never been used.'}
                </p>
              </div>
              {failure && (
                <p role="alert" className="text-sm text-destructive">
                  {failure}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" autoFocus onClick={onClose}>
                  Not now
                </Button>
                <Button className={DANGER} disabled={revoke.isPending} onClick={() => void revokeOldKey()}>
                  {revoke.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  Revoke old key
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <CloseWithoutKeyAlert
        open={confirmingClose}
        detail={`${apiKey.name} keeps working. If you haven't stored the new key, revoke it and rotate again.`}
        onStay={() => setConfirmingClose(false)}
        onClose={onClose}
      />
    </>
  )
}
