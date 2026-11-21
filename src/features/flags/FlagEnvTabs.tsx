import type { KeyboardEvent } from 'react'
import { Lock } from 'lucide-react'
import { isProtectedEnvironment, type Environment } from '@/features/environments/queries'
import { cn } from '@/lib/utils'
import type { FlagEnvStatus } from './queries'

interface FlagEnvTabsProps {
  environments: Environment[]
  selected: Environment
  statuses: FlagEnvStatus[] | undefined
  onSelect: (envName: string) => void
}

const envTabId = (env: Environment) => `env-tab-${env.id}`

function summary(status: FlagEnvStatus | undefined, loaded: boolean): string {
  if (!loaded) {
    return '…'
  }
  if (!status) {
    return 'Not set up'
  }
  return status.enabled ? `On · ${status.rolloutPercentage}%` : 'Off'
}

/** One tab per environment, each saying where the flag stands there, so choosing one keeps the whole picture. */
export function FlagEnvTabs({ environments, selected, statuses, onSelect }: FlagEnvTabsProps) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) {
      return
    }
    event.preventDefault()
    const next = environments[(index + step + environments.length) % environments.length]
    onSelect(next.name)
    document.getElementById(envTabId(next))?.focus()
  }

  return (
    <div role="tablist" aria-label="Environments" className="flex flex-wrap gap-1 border-b">
      {environments.map((env, index) => {
        const active = env.id === selected.id
        return (
          <button
            key={env.id}
            id={envTabId(env)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls="env-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(env.name)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              '-mb-px flex min-w-36 flex-col items-start gap-0.5 border-b-2 px-3 pt-2 pb-2.5 text-left',
              active ? 'border-primary' : 'border-transparent hover:bg-accent/60',
            )}
          >
            <span className="flex items-center gap-1.5 font-mono text-[13px] font-medium">
              {isProtectedEnvironment(env.name) && <Lock aria-label="protected" className="size-3" />}
              {env.name}
            </span>
            <span className="text-sm text-muted-foreground">
              {summary(
                statuses?.find((status) => status.envId === env.id),
                statuses !== undefined,
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
