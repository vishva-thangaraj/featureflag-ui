import { useId } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Lock } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { FormError } from '@/components/form/FormError'
import { TextField } from '@/components/form/TextField'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isProtectedEnvironment, type Environment } from '@/features/environments/queries'
import { applyFieldErrors, fallbackMessage } from '@/lib/form-errors'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { daysFromNow, EXPIRY_WARNING_DAYS, type CreatedApiKey, type useCreateApiKey } from './queries'

const EXPIRY_PRESETS = [
  { value: 'never', label: 'No expiry', days: null },
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
] as const

const createKeySchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100, 'Use at most 100 characters'),
  envName: z.string().min(1, 'Choose an environment'),
  expiry: z.enum(['never', '30', '90', '365']),
})

type CreateKeyValues = z.infer<typeof createKeySchema>

interface CreateKeyFormProps {
  /** Owned by the dialog, which must not close while a key is being issued: its secret would be lost. */
  createKey: ReturnType<typeof useCreateApiKey>
  /** The choices, unless `fixedEnvName` decides it already, as for a replacement key. */
  environments?: Environment[]
  fixedEnvName?: string
  defaultEnvName?: string
  defaultName?: string
  submitLabel: string
  onCancel: () => void
  onCreated: (created: CreatedApiKey) => void
}

/** The fields and footer of a dialog that issues a key; the dialog decides what follows. */
export function CreateKeyForm({
  createKey,
  environments = [],
  fixedEnvName,
  defaultEnvName,
  defaultName = '',
  submitLabel,
  onCancel,
  onCreated,
}: CreateKeyFormProps) {
  const formId = useId()
  const envId = useId()
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateKeyValues>({
    resolver: zodResolver(createKeySchema),
    mode: 'onTouched',
    defaultValues: {
      name: defaultName,
      envName: fixedEnvName ?? defaultEnvName ?? (environments.length === 1 ? environments[0].name : ''),
      expiry: 'never',
    },
  })

  const expiryValue = useWatch({ control, name: 'expiry' })
  const expiry = EXPIRY_PRESETS.find((preset) => preset.value === expiryValue)

  const onSubmit = handleSubmit(async ({ name, envName, expiry }) => {
    const days = EXPIRY_PRESETS.find((preset) => preset.value === expiry)?.days
    try {
      onCreated(await createKey.mutateAsync({ name, envName, expiresAt: days ? daysFromNow(days) : undefined }))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setError('envName', { message: `${envName} no longer exists. Choose another environment.` })
      } else if (!applyFieldErrors(error, setError, ['name', 'envName'])) {
        setError('root.server', { message: fallbackMessage(error) })
      }
    }
  })

  const envMessage =
    errors.envName?.message ??
    (fixedEnvName ? 'The same environment as the key it replaces.' : "The key reads only this environment. It can't be changed later.")

  return (
    <>
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={errors.root?.server?.message} />
        <TextField
          label="Name"
          autoComplete="off"
          spellCheck={false}
          placeholder="web-prod"
          hint="Where it's used, so you know what breaks if it's revoked."
          error={errors.name?.message}
          {...register('name')}
        />

        <div className="flex flex-col gap-1.5">
          {fixedEnvName ? <span className="text-sm font-medium">Environment</span> : <Label htmlFor={envId}>Environment</Label>}
          {fixedEnvName ? (
            <span className="flex h-9 items-center gap-1.5 font-mono text-[13px]">
              {isProtectedEnvironment(fixedEnvName) && <Lock aria-label="protected" role="img" className="size-3.5" />}
              {fixedEnvName}
            </span>
          ) : (
            <Controller
              control={control}
              name="envName"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} name={field.name}>
                  <SelectTrigger
                    id={envId}
                    ref={field.ref}
                    aria-invalid={errors.envName ? true : undefined}
                    aria-describedby={`${envId}-message`}
                    className="h-9 w-full font-mono text-[13px]"
                  >
                    <SelectValue placeholder="Select an environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((env) => (
                      <SelectItem key={env.id} value={env.name} className="font-mono text-[13px]">
                        {env.name}
                        {isProtectedEnvironment(env.name) && <Lock aria-label="protected" role="img" className="size-3" />}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
          <p id={`${envId}-message`} className={cn('text-sm', errors.envName ? 'text-destructive' : 'text-muted-foreground')}>
            {envMessage}
          </p>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Expires</legend>
          <div className="flex flex-wrap gap-1.5">
            {EXPIRY_PRESETS.map((preset) => (
              <label key={preset.value} className="cursor-pointer">
                <input type="radio" value={preset.value} className="peer sr-only" {...register('expiry')} />
                <span className="inline-flex h-8 items-center rounded-full border bg-card px-3 text-sm font-medium text-ink-secondary peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 hover:bg-accent peer-checked:hover:bg-foreground">
                  {preset.label}
                </span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {expiry?.days
              ? `Stops working on ${formatDate(daysFromNow(expiry.days))}. It's flagged here ${EXPIRY_WARNING_DAYS} days before.`
              : 'Best for keys inside shipped apps, where an expired key is an outage.'}
          </p>
        </fieldset>
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" form={formId} disabled={isSubmitting}>
          {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  )
}
