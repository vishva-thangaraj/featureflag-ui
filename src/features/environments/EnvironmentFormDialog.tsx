import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { FormError } from '@/components/form/FormError'
import { TextField } from '@/components/form/TextField'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { applyFieldErrors, fallbackMessage } from '@/lib/form-errors'
import { useCreateEnvironment, useUpdateEnvironment, type Environment } from './queries'

// The backend's own pattern: the name travels as a query parameter, so it is limited to what survives one.
const environmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name')
    .max(50, 'Use at most 50 characters')
    .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/, 'Start with a letter, then use letters, digits, _ . or -'),
  description: z.string().trim().max(255, 'Use at most 255 characters'),
})

type EnvironmentValues = z.infer<typeof environmentSchema>

interface EnvironmentFormDialogProps {
  /** Absent to create one. */
  environment?: Environment
  onClose: () => void
}

export function EnvironmentFormDialog({ environment, onClose }: EnvironmentFormDialogProps) {
  const createEnvironment = useCreateEnvironment()
  const updateEnvironment = useUpdateEnvironment()
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EnvironmentValues>({
    resolver: zodResolver(environmentSchema),
    mode: 'onTouched',
    defaultValues: { name: environment?.name ?? '', description: environment?.description ?? '' },
  })

  const name = useWatch({ control, name: 'name' }).trim()
  const renaming = environment !== undefined && name !== '' && name !== environment.name

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (!environment) {
        await createEnvironment.mutateAsync({ name: values.name, description: values.description || undefined })
        toast.success(`${values.name} created`)
      } else {
        const changes = {
          name: values.name !== environment.name ? values.name : undefined,
          description: values.description !== (environment.description ?? '') ? values.description : undefined,
        }
        if (changes.name !== undefined || changes.description !== undefined) {
          await updateEnvironment.mutateAsync({ envId: environment.id, ...changes })
          toast.success('Changes saved')
        }
      }
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('name', { message: 'An environment with this name already exists.' })
      } else if (!applyFieldErrors(error, setError, ['name', 'description'])) {
        setError('root.server', { message: fallbackMessage(error) })
      }
    }
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{environment ? `Edit ${environment.name}` : 'New environment'}</DialogTitle>
          <DialogDescription>
            Each environment has its own on/off state, rollout, rules and overrides for every flag.
          </DialogDescription>
        </DialogHeader>
        <form id="environment-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={errors.root?.server?.message} />
          <TextField
            label="Name"
            className="font-mono"
            autoComplete="off"
            hint="Used in API calls as envName. Letters, digits, _ . or -, starting with a letter."
            error={errors.name?.message}
            {...register('name')}
          />
          {renaming && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              Anything calling <code className="font-mono text-xs">/config?envName={environment.name}</code> needs the
              new name. SDK keys keep working.
            </p>
          )}
          <TextField label="Description" optional error={errors.description?.message} {...register('description')} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="environment-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {environment ? 'Save changes' : 'Create environment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
