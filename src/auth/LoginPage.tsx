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
import { NETWORK_ERROR } from '@/lib/form-errors'
import { AuthLayout } from './AuthLayout'
import { login } from './session'

// Only "not empty" for the password: a length rule belongs to registration, and enforcing it here
// could lock out an account created under older rules.
const signInSchema = z.object({
  email: z.email('Enter an email address'),
  password: z.string().min(1, 'Enter your password'),
})

type SignInValues = z.infer<typeof signInSchema>

function signInError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return NETWORK_ERROR
  }
  switch (error.status) {
    case 401:
      // Never which of the two: that would tell anyone whether an address has an account.
      return 'Email or password is incorrect.'
    case 403:
      return 'This account is suspended.'
    case 429:
      return 'Too many attempts.'
    default:
      return error.message
  }
}

export function LoginPage() {
  const location = useLocation()
  const [retryIn, setRetryIn] = useCountdown()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  // Success needs no navigation here: RequireSignedOut moves the user on when the session starts.
  const onSubmit = handleSubmit(async ({ email, password }) => {
    try {
      await login(email, password)
    } catch (error) {
      setError('root.server', { message: signInError(error) })
      if (error instanceof ApiError && error.retryAfter) {
        setRetryIn(error.retryAfter)
      }
    }
  })

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          New here?{' '}
          <Link to={`/register${location.search}`} className="font-medium text-link">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={errors.root?.server?.message} />
        <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" className="h-9" disabled={isSubmitting || retryIn > 0}>
          {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {retryIn > 0 ? `Try again in ${retryIn} s` : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  )
}
