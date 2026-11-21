import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { CopyButton } from '@/components/CopyButton'
import { FormError } from '@/components/form/FormError'
import { TextField } from '@/components/form/TextField'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { applyFieldErrors, fallbackMessage } from '@/lib/form-errors'
import { useTenant, type Tenant } from '@/tenant/context'
import { useCan } from '@/tenant/permissions'
import { useRenameTenant } from '@/tenant/queries'
import { DeleteOrganizationDialog } from './DeleteOrganizationDialog'

const PLAN_LABELS: Record<Tenant['plan'], string> = { FREE: 'Free', PRO: 'Pro', ENTERPRISE: 'Enterprise' }

// The server takes any name on a rename, an empty one included; 255 is the column's limit.
const renameSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for the organization').max(255, 'Use at most 255 characters'),
})

type RenameValues = z.infer<typeof renameSchema>

export function SettingsPage() {
  const tenant = useTenant()
  const canManage = useCan('manageOrganization')

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <PageHeader title="Settings" description="Your organization's name, plan and id." />

      <section aria-labelledby="settings-general" className="flex flex-col gap-5 rounded-xl border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h2 id="settings-general" className="text-base font-semibold">
            General
          </h2>
          {!canManage && (
            <p className="text-sm text-muted-foreground">View only. Only an owner can rename or delete the organization.</p>
          )}
        </div>

        {canManage ? (
          <RenameForm key={tenant.id} tenant={tenant} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Organization name</span>
            <span>{tenant.name}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Plan</span>
          <Badge variant="secondary">{PLAN_LABELS[tenant.plan]}</Badge>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Organization id</span>
          <div className="flex items-center gap-1">
            <code className="font-mono text-[13px] font-medium break-all">{tenant.id}</code>
            <CopyButton value={tenant.id} label="Organization id" />
          </div>
          <p className="text-sm text-muted-foreground">For support requests and scripts that call the API.</p>
        </div>
      </section>

      {canManage && <DangerZone key={tenant.id} tenant={tenant} />}
    </div>
  )
}

function RenameForm({ tenant }: { tenant: Tenant }) {
  const queryClient = useQueryClient()
  const renameTenant = useRenameTenant()
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    mode: 'onTouched',
    defaultValues: { name: tenant.name },
  })

  const onSubmit = handleSubmit(async ({ name }) => {
    if (name === tenant.name) {
      reset({ name })
      return
    }
    try {
      await renameTenant.mutateAsync(name)
      reset({ name })
      toast.success(`Renamed to ${name}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        // The role changed since the page loaded. The refetch takes this form away, so the reason goes in a toast.
        toast.error(`Only an owner can rename ${tenant.name}. Your role may have changed.`)
        void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      } else if (!applyFieldErrors(error, setError, ['name'])) {
        setError('root.server', { message: fallbackMessage(error) })
      }
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <FormError message={errors.root?.server?.message} />
      <TextField
        label="Organization name"
        autoComplete="organization"
        hint="Shown in the organization switcher and to everyone you invite."
        error={errors.name?.message}
        {...register('name')}
      />
      <Button type="submit" className="self-start" disabled={isSubmitting}>
        {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        Save name
      </Button>
    </form>
  )
}

function DangerZone({ tenant }: { tenant: Tenant }) {
  const [deleting, setDeleting] = useState(false)

  return (
    <section aria-labelledby="settings-danger" className="flex flex-col gap-4 rounded-xl border border-destructive/40 bg-card p-6">
      <h2 id="settings-danger" className="text-base font-semibold">
        Danger zone
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex max-w-md flex-col gap-1">
          <span className="font-medium">Delete organization</span>
          <span className="text-sm text-muted-foreground">
            Deletes {tenant.name} with every flag, environment, API key and invitation in it, and removes every member.
            This can't be undone.
          </span>
        </div>
        <Button variant="destructive" onClick={() => setDeleting(true)}>
          Delete organization
        </Button>
      </div>
      {deleting && <DeleteOrganizationDialog tenant={tenant} onClose={() => setDeleting(false)} />}
    </section>
  )
}
