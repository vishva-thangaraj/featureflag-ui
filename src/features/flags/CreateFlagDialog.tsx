import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router'
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
import { useTenantId } from '@/tenant/context'
import { FLAG_KEY_PATTERN, suggestFlagKey } from './keys'
import { useCreateFeature, useFeatures } from './queries'

const createFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Enter a key')
    .max(50, 'Use at most 50 characters')
    .regex(FLAG_KEY_PATTERN, 'Start with a letter, then use letters, digits, _ . or -'),
  description: z.string().trim().max(255, 'Use at most 255 characters'),
})

type CreateFlagValues = z.infer<typeof createFlagSchema>

export function CreateFlagDialog({ onClose }: { onClose: () => void }) {
  const tenantId = useTenantId()
  const features = useFeatures()
  const createFeature = useCreateFeature()
  const [existingId, setExistingId] = useState<string>()
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateFlagValues>({
    resolver: zodResolver(createFlagSchema),
    mode: 'onTouched',
    defaultValues: { key: '', description: '' },
  })

  const typedKey = useWatch({ control, name: 'key' })
  const description = useWatch({ control, name: 'description' })
  const suggestion = errors.key ? suggestFlagKey(typedKey) : null

  const onSubmit = handleSubmit(async ({ key, description }) => {
    setExistingId(undefined)
    try {
      await createFeature.mutateAsync({ key, description: description || undefined })
      toast.success(`${key} created. It's off everywhere until you turn it on.`)
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('key', { message: 'A flag with this key already exists.' })
        setExistingId(features.data?.find((feature) => feature.key === key)?.id)
      } else if (!applyFieldErrors(error, setError, ['key', 'description'])) {
        setError('root.server', { message: fallbackMessage(error) })
      }
    }
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New flag</DialogTitle>
          <DialogDescription>It starts off in every environment until you turn it on.</DialogDescription>
        </DialogHeader>
        <form id="create-flag" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={errors.root?.server?.message} />
          <div className="flex flex-col gap-1.5">
            <TextField
              label="Key"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="checkout_v2"
              hint="Used in your code. Letters, digits, _ . or -, starting with a letter. Can't be changed later."
              error={errors.key?.message}
              {...register('key')}
            />
            {suggestion && (
              <Button
                type="button"
                variant="link"
                className="h-auto self-start p-0"
                onClick={() => setValue('key', suggestion, { shouldValidate: true })}
              >
                Use <code className="font-mono">{suggestion}</code>
              </Button>
            )}
            {existingId && (
              <Link to={`/t/${tenantId}/flags/${existingId}`} className="self-start text-sm font-medium text-link">
                Open the existing flag
              </Link>
            )}
          </div>
          <TextField
            label="Description"
            optional
            hint={description.length > 200 ? `${description.length} of 255 characters` : undefined}
            error={errors.description?.message}
            {...register('description')}
          />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-flag" disabled={isSubmitting}>
            {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Create flag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
