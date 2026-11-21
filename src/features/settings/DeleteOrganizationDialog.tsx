import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
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
import { isExpired, useApiKeys } from '@/features/api-keys/queries'
import { useEnvironments } from '@/features/environments/queries'
import { useFeatures } from '@/features/flags/queries'
import { useInvitations, useMembers } from '@/features/members/queries'
import { fallbackMessage } from '@/lib/form-errors'
import type { Tenant } from '@/tenant/context'
import { useDeleteTenant } from '@/tenant/queries'

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

interface DeleteOrganizationDialogProps {
  tenant: Tenant
  onClose: () => void
}

export function DeleteOrganizationDialog({ tenant, onClose }: DeleteOrganizationDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deleteTenant = useDeleteTenant()
  const [typedName, setTypedName] = useState('')
  const [failure, setFailure] = useState<string>()
  const confirmId = useId()

  const ready = typedName === tenant.name && !deleteTenant.isPending

  async function confirmDelete() {
    setFailure(undefined)
    try {
      await deleteTenant.mutateAsync()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        // The refetch closes this dialog for anyone no longer an owner, so the reason goes in a toast.
        toast.error(`Only an owner can delete ${tenant.name}. Your role may have changed.`)
        void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      } else {
        setFailure(fallbackMessage(error))
      }
      return
    }
    toast.success(`${tenant.name} deleted`)
    // "/" picks the next organization, or the create page when none is left.
    navigate('/', { replace: true })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {tenant.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This can't be undone. Everything in the organization is deleted with it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* The counts stop observing before the delete drops their queries, so none is fetched again with this id. */}
        {deleteTenant.isIdle || deleteTenant.isError ? (
          <Consequences />
        ) : (
          <p role="status" className="rounded-lg bg-muted px-3 py-2.5 text-sm">
            Deleting {tenant.name}…
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={confirmId}>Type {tenant.name} to confirm</Label>
          <Input
            id={confirmId}
            className="h-9"
            autoComplete="off"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </div>

        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button className={DANGER} disabled={!ready} onClick={() => void confirmDelete()}>
            {deleteTenant.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Delete organization
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Live counts, so the owner sees the size of what goes rather than a generic warning. */
function Consequences() {
  const features = useFeatures()
  const environments = useEnvironments()
  const keys = useApiKeys()
  const members = useMembers()
  const invitations = useInvitations()
  const queries = [features, environments, keys, members, invitations]

  if (queries.some((query) => query.isError)) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm">
        <p>Couldn't count what goes with it.</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => queries.filter((query) => query.isError).forEach((query) => void query.refetch())}
        >
          Try again
        </Button>
      </div>
    )
  }
  if (!features.data || !environments.data || !keys.data || !members.data || !invitations.data) {
    return (
      <div role="status" aria-label="Counting what goes with it" className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2.5">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="h-4 animate-pulse rounded bg-background" />
        ))}
      </div>
    )
  }

  const keysInUse = keys.data.filter((key) => key.revokedAt == null && !isExpired(key)).length
  const pendingInvitations = invitations.data.filter((invitation) => invitation.status === 'PENDING').length

  return (
    <ul aria-label="Deleted with it" className="flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm">
      <Consequence label={counted(features.data.length, 'flag', 'flags')} detail="with their rules and overrides" />
      <Consequence label={counted(environments.data.length, 'environment', 'environments')} />
      <Consequence
        label={counted(keysInUse, 'API key in use', 'API keys in use')}
        detail={keysInUse > 0 ? `and SDKs using ${keysInUse === 1 ? 'it' : 'them'} stop immediately` : undefined}
      />
      <Consequence
        label={counted(members.data.length, 'member', 'members')}
        detail="whose access ends; their accounts and other organizations stay"
      />
      <Consequence
        label={counted(pendingInvitations, 'pending invitation', 'pending invitations')}
        detail={pendingInvitations > 0 ? `whose ${pendingInvitations === 1 ? 'link stops' : 'links stop'} working` : undefined}
      />
    </ul>
  )
}

function Consequence({ label, detail }: { label: string; detail?: string }) {
  return (
    <li>
      <span className="font-medium tabular-nums">{label}</span>
      {detail && <span className="text-muted-foreground">, {detail}</span>}
    </li>
  )
}
