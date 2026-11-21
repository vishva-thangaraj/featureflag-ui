import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Environment } from '@/features/environments/queries'
import { CreateKeyForm } from './CreateKeyForm'
import { CloseWithoutKeyAlert, KeyReveal } from './KeyReveal'
import { useCreateApiKey, type CreatedApiKey } from './queries'

interface CreateApiKeyDialogProps {
  environments: Environment[]
  defaultEnvName?: string
  onClose: () => void
}

export function CreateApiKeyDialog({ environments, defaultEnvName, onClose }: CreateApiKeyDialogProps) {
  const createKey = useCreateApiKey()
  const [created, setCreated] = useState<CreatedApiKey>()
  const [stored, setStored] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const storedId = useId()

  function requestClose() {
    if (createKey.isPending) {
      return
    }
    if (created && !stored) {
      setConfirmingClose(true)
    } else {
      onClose()
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent className="sm:max-w-lg">
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Key created</DialogTitle>
                <DialogDescription>
                  {created.apiKey.name} reads <span className="font-mono">{created.apiKey.envName}</span>. Put it in your
                  app's secret store now.
                </DialogDescription>
              </DialogHeader>
              <KeyReveal secret={created.key} />
              <div className="flex items-center gap-2">
                <input
                  id={storedId}
                  type="checkbox"
                  checked={stored}
                  onChange={(event) => setStored(event.target.checked)}
                  className="size-4 accent-primary"
                />
                <label id={`${storedId}-label`} htmlFor={storedId} className="text-sm">
                  I've stored this key somewhere safe
                </label>
              </div>
              <DialogFooter>
                <Button disabled={!stored} aria-describedby={`${storedId}-label`} onClick={onClose}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create key</DialogTitle>
                <DialogDescription>SDKs use a key to read one environment's flags.</DialogDescription>
              </DialogHeader>
              <CreateKeyForm
                createKey={createKey}
                environments={environments}
                defaultEnvName={defaultEnvName}
                submitLabel="Create key"
                onCancel={onClose}
                onCreated={setCreated}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
      <CloseWithoutKeyAlert
        open={confirmingClose}
        detail="Only a hash of it is kept. If you haven't stored it, revoke it and create another."
        onStay={() => setConfirmingClose(false)}
        onClose={onClose}
      />
    </>
  )
}
