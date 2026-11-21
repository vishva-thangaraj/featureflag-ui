import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isProtectedEnvironment } from '@/features/environments/queries'
import { fallbackMessage } from '@/lib/form-errors'
import { useTenantId } from '@/tenant/context'
import { useDeleteFeature, type Feature, type FlagEnvStatus } from './queries'

interface DeleteFlagDialogProps {
  feature: Feature
  statuses: FlagEnvStatus[]
  onClose: () => void
}

/** Irreversible, and wide when the flag is live in production: then the key has to be typed. */
export function DeleteFlagDialog({ feature, statuses, onClose }: DeleteFlagDialogProps) {
  const tenantId = useTenantId()
  const navigate = useNavigate()
  const deleteFeature = useDeleteFeature(feature.id)
  const [typedKey, setTypedKey] = useState('')
  const confirmId = useId()

  const liveInProtected = statuses.filter((status) => status.enabled && isProtectedEnvironment(status.envName))
  const ready = (liveInProtected.length === 0 || typedKey === feature.key) && !deleteFeature.isPending

  async function confirmDelete() {
    try {
      await deleteFeature.mutateAsync()
      toast.success(`${feature.key} deleted`)
      // The flag is gone, so an unsaved rollout draft on its page has nothing left to save.
      navigate(`/t/${tenantId}/flags`, { replace: true, state: { discardDraft: true } })
    } catch (error) {
      toast.error(`Couldn't delete ${feature.key}. ${fallbackMessage(error)}`)
    }
  }

  const setUpIn = statuses.length

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {feature.key}?</AlertDialogTitle>
          <AlertDialogDescription>
            {setUpIn === 0
              ? "It isn't set up in any environment yet."
              : `This removes it and its setup in ${setUpIn} environment${setUpIn === 1 ? '' : 's'}. SDKs stop receiving it and fall back to the default in your code.`}{' '}
            This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {liveInProtected.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-warning">
              It's on in {liveInProtected.map((status) => status.envName).join(', ')} right now.
            </p>
            <Label htmlFor={confirmId}>
              Type <code className="font-mono">{feature.key}</code> to confirm
            </Label>
            <Input
              id={confirmId}
              className="h-9 font-mono"
              autoComplete="off"
              value={typedKey}
              onChange={(event) => setTypedKey(event.target.value)}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            className="bg-danger-strong text-white hover:bg-danger-strong/90"
            disabled={!ready}
            onClick={() => void confirmDelete()}
          >
            {deleteFeature.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Delete flag
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
