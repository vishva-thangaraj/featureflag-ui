import { CopyButton } from '@/components/CopyButton'
import type { FlagConfig } from './queries'

const users = (count: number) => `${count} user${count === 1 ? '' : 's'}`

/** The saved configuration, exactly as an SDK receives it, and the order an SDK reads it in. */
export function SdkPayload({ config, envName }: { config: FlagConfig | null; envName: string }) {
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="cursor-pointer px-4 py-3 font-medium select-none">What SDKs receive</summary>
      <div className="flex flex-col gap-4 border-t px-4 py-4">
        {!config ? (
          <p className="text-muted-foreground">SDKs don't receive this flag in {envName}: it isn't set up there.</p>
        ) : (
          <>
            <ol className="grid gap-1.5 text-sm sm:grid-cols-5">
              <EvaluationStep step={1} name="Kill switch" value={config.enabled ? 'On' : 'Off'} />
              <EvaluationStep step={2} name="Deny list" value={users(config.disabledUsers.length)} />
              <EvaluationStep step={3} name="Allow list" value={users(config.enabledUsers.length)} />
              <EvaluationStep
                step={4}
                name="Rules"
                value={config.rules.length === 0 ? 'None' : `${config.rules.length}, all must match`}
              />
              <EvaluationStep step={5} name="Rollout" value={`${config.rolloutPercentage}%`} />
            </ol>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Saved configuration. Paused rules aren't sent.</span>
                <CopyButton value={JSON.stringify(config, null, 2)} label="SDK configuration" />
              </div>
              <pre className="max-h-80 overflow-auto rounded-lg border bg-code p-3 font-mono text-xs leading-relaxed">
                {JSON.stringify(config, null, 2)}
              </pre>
            </div>
          </>
        )}
      </div>
    </details>
  )
}

function EvaluationStep({ step, name, value }: { step: number; name: string; value: string }) {
  return (
    <li className="flex flex-col rounded-lg bg-muted px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {step} · {name}
      </span>
      <span className="font-medium">{value}</span>
    </li>
  )
}
