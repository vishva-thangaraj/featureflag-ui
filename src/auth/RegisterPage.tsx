import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation } from 'react-router'
import { Loader2 } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { FormError } from '@/components/form/FormError'
import { TextField } from '@/components/form/TextField'
import { Button } from '@/components/ui/button'
import { useCountdown } from '@/hooks/useCountdown'
import { applyFieldErrors, fallbackMessage } from '@/lib/form-errors'
import { AuthLayout } from './AuthLayout'
import { register as createAccount } from './session'

const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name'),
  lastName: z.string().trim(),
  email: z.email('Enter an email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(128, 'Use at most 128 characters'),
})

type RegisterValues = z.infer<typeof registerSchema>

const FIELDS = ['firstName', 'lastName', 'email', 'password'] as const

export function RegisterPage() {
  const location = useLocation()
  const [retryIn, setRetryIn] = useCountdown()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: { firstName: '', lastName: '', email: '', password: '' },
  })

  // Success needs no navigation here: RequireSignedOut moves the user on, and with no organization
  // yet the picker sends them to create one.
  const onSubmit = handleSubmit(async ({ lastName, ...values }) => {
    try {
      await createAccount({ ...values, lastName: lastName || undefined })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('email', { message: 'An account with this email already exists.' })
      } else if (!applyFieldErrors(error, setError, FIELDS)) {
        setError('root.server', { message: fallbackMessage(error) })
      }
      if (error instanceof ApiError && error.retryAfter) {
        setRetryIn(error.retryAfter)
      }
    }
  })

  return (
    <AuthLayout
      title="Create an account"
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login${location.search}`} className="font-medium text-link">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={errors.root?.server?.message} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="First name" autoComplete="given-name" error={errors.firstName?.message} {...register('firstName')} />
          <TextField label="Last name" optional autoComplete="family-name" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="8 to 128 characters."
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" className="h-9" disabled={isSubmitting || retryIn > 0}>
          {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {retryIn > 0 ? `Try again in ${retryIn} s` : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
