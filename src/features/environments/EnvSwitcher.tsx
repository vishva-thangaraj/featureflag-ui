import { Lock } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { isProtectedEnvironment, type Environment } from './queries'

interface EnvSwitcherProps {
  environments: Environment[]
  selected: Environment
  onSelect: (envName: string) => void
}

/** Every choice visible, one click away, for up to four environments; a menu past that. */
export function EnvSwitcher({ environments, selected, onSelect }: EnvSwitcherProps) {
  if (environments.length > 4) {
    return (
      <Select value={selected.name} onValueChange={onSelect}>
        <SelectTrigger aria-label="Environment" className="h-9 min-w-44 font-mono text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {environments.map((env) => (
            <SelectItem key={env.id} value={env.name} className="font-mono text-[13px]">
              {env.name}
              {isProtectedEnvironment(env.name) && <Lock aria-label="protected" className="size-3" />}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <div role="group" aria-label="Environment" className="inline-flex flex-wrap rounded-lg border bg-card p-0.5">
      {environments.map((env) => {
        const active = env.id === selected.id
        return (
          <button
            key={env.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(env.name)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-3 font-mono text-[13px] font-medium',
              active ? 'bg-foreground text-background' : 'text-ink-secondary hover:bg-accent',
            )}
          >
            {isProtectedEnvironment(env.name) && <Lock aria-hidden="true" className="size-3" />}
            {env.name}
            {isProtectedEnvironment(env.name) && <span className="sr-only">, protected</span>}
          </button>
        )
      })}
    </div>
  )
}
