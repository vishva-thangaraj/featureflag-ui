import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/errors'
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
import { Switch } from '@/components/ui/switch'
import { isProtectedEnvironment, type Environment } from '@/features/environments/queries'
import { fallbackMessage } from '@/lib/form-errors'
import { cn } from '@/lib/utils'
import { useSetFlagEnabled, type Feature } from './queries'

interface FlagSwitchProps {
  feature: Feature
  environment: Environment
  enabled: boolean
  canWrite: boolean
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiError && error.retryAfter) {
    return `Too many changes at once. Try again in ${error.retryAfter} s.`
  }
  return fallbackMessage(error)
}

/**
 * The kill switch. Outside protected environments it applies at once, with Undo; in a protected one it
 * asks first. Read-only roles see the state as a word, not a disabled switch.
 */
export function FlagSwitch({ feature, environment, enabled, canWrite }: FlagSwitchProps) {
  const setEnabled = useSetFlagEnabled()
  const [confirming, setConfirming] = useState<boolean | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  if (!canWrite) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn('size-1.5 rounded-full', enabled ? 'bg-success-strong' : 'bg-muted-foreground/40')}
        />
        {enabled ? 'On' : 'Off'}
      </span>
    )
  }

  function apply(next: boolean, offerUndo: boolean) {
    const variables = {
      featureId: feature.id,
      featureKey: feature.key,
      envId: environment.id,
      envName: environment.name,
      enabled: next,
    }
    setEnabled.mutate(variables, {
      onSuccess: () => {
        if (offerUndo) {
          toast(`${feature.key} turned ${next ? 'on' : 'off'} in ${environment.name}`, {
            duration: 6000,
            action: { label: 'Undo', onClick: () => apply(!next, false) },
          })
        }
      },
      onError: (error) => {
        toast.error(`Couldn't turn ${feature.key} ${next ? 'on' : 'off'}. ${failureMessage(error)}`)
      },
    })
  }

  function onCheckedChange(next: boolean) {
    if (isProtectedEnvironment(environment.name)) {
      setConfirming(next)
    } else {
      apply(next, true)
    }
  }

  const verb = confirming ? 'Turn on' : 'Turn off'

  return (
    <span className="inline-flex items-center gap-2">
      <Switch
        checked={enabled}
        onCheckedChange={onCheckedChange}
        disabled={setEnabled.isPending}
        aria-label={`${feature.key} in ${environment.name}`}
      />
      <span aria-hidden="true" className={cn('w-6', !enabled && 'text-muted-foreground')}>
        {enabled ? 'On' : 'Off'}
      </span>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            // Reversible, so Enter may confirm: focus the action, not Cancel.
            event.preventDefault()
            confirmRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {verb} <code className="font-mono">{feature.key}</code> in {environment.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {environment.name} is protected. SDKs pick up the change on their next poll.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              ref={confirmRef}
              onClick={() => {
                if (confirming !== null) {
                  apply(confirming, false)
                }
                setConfirming(null)
              }}
            >
              {verb}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  )
}
