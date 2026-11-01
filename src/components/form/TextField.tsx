import { useId, useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface TextFieldProps extends ComponentProps<'input'> {
  label: string
  /** Shown under the input until there is an error, which replaces it. */
  hint?: string
  error?: string
  optional?: boolean
}

/** Label above, hint or error below, wired up so a screen reader reads them with the input. */
export function TextField({ id, label, hint, error, optional, type, className, ...inputProps }: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-message`
  const message = error ?? hint
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">{' '}(optional)</span>}
      </Label>
      <div className="relative">
        <Input
          id={inputId}
          type={isPassword && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn('h-9', isPassword && 'pr-10', className)}
          {...inputProps}
        />
        {isPassword && (
          <button
            type="button"
            aria-label="Show password"
            aria-pressed={revealed}
            onClick={() => setRevealed((shown) => !shown)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {revealed ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
          </button>
        )}
      </div>
      {message && (
        <p id={messageId} className={cn('text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>
          {message}
        </p>
      )}
    </div>
  )
}
