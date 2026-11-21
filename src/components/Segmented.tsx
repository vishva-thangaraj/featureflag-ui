import { useId } from 'react'
import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string> {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

/** A choice of two or three, built on native radios so arrow keys move between them. */
export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-9 shrink-0 rounded-lg border bg-muted p-0.5">
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-center rounded-md px-3 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
            value === option.value ? 'bg-card font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
