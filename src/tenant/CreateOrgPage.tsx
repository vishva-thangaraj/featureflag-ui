import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { z } from 'zod'
import { AuthLayout } from '@/auth/AuthLayout'
import { signOut } from '@/auth/signOut'
import { FormError } from '@/components/form/FormError'
import { TextField } from '@/components/form/TextField'
import { Button } from '@/components/ui/button'
import { applyFieldErrors, fallbackMessage } from '@/lib/form-errors'
import { useCreateTenant, useTenants } from './queries'

const createOrgSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for the organization').max(255, 'Use at most 255 characters'),
})

type CreateOrgValues = z.infer<typeof createOrgSchema>

export function CreateOrgPage() {
  const navigate = useNavigate()
  const tenants = useTenants()
  const createTenant = useCreateTenant()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema),
    mode: 'onTouched',
    defaultValues: { name: '' },
  })

  const onSubmit = handleSubmit(async ({ name }) => {
    try {
      const tenant = await createTenant.mutateAsync(name)
      navigate(`/t/${tenant.id}/flags`, { replace: true })
    } catch (error) {
      if (!applyFieldErrors(error, setError, ['name'])) {
        setError('root.server', { message: fallbackMessage(error) })
      }
    }
  })

  // Outside the shell, so this page has to offer its own way out.
  const hasOrganizations = (tenants.data?.length ?? 0) > 0

  return (
    <AuthLayout
      title="Create an organization"
      description="Flags, environments and API keys belong to an organization. You can rename it later."
      footer={
        <div className="flex items-center gap-4">
          {hasOrganizations && (
            <Link to="/orgs" className="font-medium text-link">
              Back to your organizations
            </Link>
          )}
          <button type="button" onClick={signOut} className="font-medium text-link">
            Sign out
          </button>
        </div>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={errors.root?.server?.message} />
        <TextField label="Organization name" autoComplete="organization" error={errors.name?.message} {...register('name')} />
        <Button type="submit" className="h-9" disabled={isSubmitting}>
          {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Create organization
        </Button>
      </form>
    </AuthLayout>
  )
}
