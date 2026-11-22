import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { CopyButton } from '@/components/CopyButton'
import { Button } from '@/components/ui/button'
import { CreateApiKeyDialog } from '@/features/api-keys/CreateApiKeyDialog'
import { formatLastUsed } from '@/features/api-keys/queries'
import {
  isProtectedEnvironment,
  STANDARD_ENVIRONMENTS,
  useCreateStandardEnvironments,
} from '@/features/environments/queries'
import { CreateFlagDialog } from '@/features/flags/CreateFlagDialog'
import { FlagSwitch } from '@/features/flags/FlagSwitch'
import { fallbackMessage } from '@/lib/form-errors'
import { cn } from '@/lib/utils'
import { useTenant } from '@/tenant/context'
import { STEPS, type FirstRunProgress, type StepId } from './progress'
import type { FirstRun } from './useFirstRun'

const TITLES: Record<StepId, (progress: FirstRunProgress) => string> = {
  environments: () => 'Create environments',
  flag: () => 'Create your first flag',
  enabled: (progress) => `Turn it on in ${progress.environment?.name ?? 'development'}`,
  key: () => 'Create an API key',
  read: () => 'Connect an SDK',
}

/** The five steps from a new organization to an SDK reading a flag, each ticked from real data. */
export function FirstRunChecklist({ firstRun }: { firstRun: FirstRun }) {
  const tenant = useTenant()
  const titleId = useId()
  const [creatingFlag, setCreatingFlag] = useState(false)
  const [creatingKey, setCreatingKey] = useState(false)
  const progress = firstRun.progress!
  const { environment, flag, key, readAt, done, doneCount, current } = progress

  function hide() {
    firstRun.hide()
    toast('Setup checklist hidden', { duration: 6000, action: { label: 'Undo', onClick: firstRun.show } })
  }

  if (current === undefined) {
    return (
      <section
        aria-labelledby={titleId}
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
            <Check className="size-4" />
          </span>
          <div>
            <h2 id={titleId} className="font-semibold">
              You're set up
            </h2>
            <p className="text-sm text-muted-foreground">
              <code className="font-mono">{flag?.key}</code> is on in {environment?.name}, and an SDK has read it.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={firstRun.hide}>
          Done
        </Button>
      </section>
    )
  }

  const summaries: Record<StepId, ReactNode> = {
    environments: firstRun.environments.map((env) => env.name).join(' · '),
    flag: <code className="font-mono">{flag?.key}</code>,
    enabled: (
      <>
        <code className="font-mono">{flag?.key}</code> is on in {environment?.name}
      </>
    ),
    key: key && `${key.name} · ${key.envName}`,
    read: readAt && `First request seen ${formatLastUsed(readAt)}`,
  }

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex flex-col gap-0.5">
          <h2 id={titleId} className="font-semibold">
            Get your first flag to an SDK
          </h2>
          <p className="text-sm text-muted-foreground">
            Five steps take {tenant.name} from no flags to an SDK reading one.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
            {doneCount} of {STEPS.length} done
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Hide the setup checklist" onClick={hide}>
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div aria-hidden="true" className="h-1 bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
      </div>

      <ol>
        {STEPS.map((step, index) => (
          <Step
            key={step}
            number={index + 1}
            state={done[step] ? 'done' : step === current ? 'current' : 'todo'}
            title={TITLES[step](progress)}
            summary={summaries[step]}
          >
            {step === current && (
              <StepBody
                step={step}
                firstRun={firstRun}
                onCreateFlag={() => setCreatingFlag(true)}
                onCreateKey={() => setCreatingKey(true)}
              />
            )}
          </Step>
        ))}
      </ol>

      <p className="border-t px-5 py-3 text-sm text-muted-foreground">
        Each step ticks itself when it happens, here or through the API.
      </p>

      {creatingFlag && <CreateFlagDialog onClose={() => setCreatingFlag(false)} />}
      {creatingKey && (
        <CreateApiKeyDialog
          environments={firstRun.environments}
          defaultEnvName={environment?.name}
          onClose={() => setCreatingKey(false)}
        />
      )}
    </section>
  )
}

interface StepProps {
  number: number
  state: 'done' | 'current' | 'todo'
  title: string
  summary: ReactNode
  children: ReactNode
}

function Step({ number, state, title, summary, children }: StepProps) {
  return (
    <li aria-current={state === 'current' ? 'step' : undefined} className="flex gap-3 border-t px-5 py-3.5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          state === 'done' && 'bg-success-soft text-success',
          state === 'current' && 'bg-primary text-primary-foreground',
          state === 'todo' && 'bg-muted text-muted-foreground',
        )}
      >
        {state === 'done' ? <Check className="size-3.5" /> : number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className={cn('font-medium', state === 'todo' && 'text-muted-foreground')}>
          <span className="sr-only">{state === 'done' ? 'Done: ' : state === 'current' ? 'Next: ' : 'Later: '}</span>
          {title}
        </h3>
        {state === 'done' && summary && <p className="-mt-1 text-sm text-muted-foreground">{summary}</p>}
        {children}
      </div>
    </li>
  )
}

interface StepBodyProps {
  step: StepId
  firstRun: FirstRun
  onCreateFlag: () => void
  onCreateKey: () => void
}

function StepBody({ step, firstRun, onCreateFlag, onCreateKey }: StepBodyProps) {
  const tenant = useTenant()
  const createStandard = useCreateStandardEnvironments()
  const { environment, flag, key } = firstRun.progress!

  switch (step) {
    case 'environments':
      return (
        <>
          <p className="text-sm text-muted-foreground">Flags are switched on per environment. Most teams start with three.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={createStandard.isPending}
              className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal"
              onClick={() =>
                createStandard.mutate(undefined, {
                  onSuccess: () => toast.success(`Created ${STANDARD_ENVIRONMENTS.join(', ')}`),
                  onError: (error) => toast.error(`Couldn't create them all. ${fallbackMessage(error)}`),
                })
              }
            >
              {createStandard.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Create development, staging and production
            </Button>
            <Button asChild variant="outline">
              <Link to={`/t/${tenant.id}/environments`}>Name them yourself</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">production is protected: changes there ask for confirmation first.</p>
        </>
      )
    case 'flag':
      return (
        <>
          <p className="text-sm text-muted-foreground">A key your code asks for. It starts off in every environment.</p>
          <Button className="self-start" onClick={onCreateFlag}>
            <Plus aria-hidden="true" className="size-4" />
            Create flag
          </Button>
        </>
      )
    case 'enabled':
      return (
        <>
          <p className="text-sm text-muted-foreground">
            {isProtectedEnvironment(environment!.name)
              ? `${environment!.name} is protected, so this asks first.`
              : `${environment!.name} isn't protected, so this applies at once, with Undo.`}
          </p>
          <div className="flex flex-wrap items-center gap-3 self-start rounded-lg border px-3 py-2">
            <code className="font-mono text-[13px]">{flag!.key}</code>
            <span className="text-sm text-muted-foreground">in {environment!.name}</span>
            <FlagSwitch feature={flag!} environment={environment!} enabled={false} canWrite />
          </div>
        </>
      )
    case 'key':
      return (
        <>
          <p className="text-sm text-muted-foreground">SDKs read flags with a key. Each key reads one environment.</p>
          <Button className="self-start" onClick={onCreateKey}>
            Create {environment ? `a ${environment.name}` : 'a'} key
          </Button>
          <p className="text-sm text-muted-foreground">The key is shown once. Copy it before you close the dialog.</p>
        </>
      )
    case 'read': {
      const curl = `curl -H "X-API-Key: <the key from step 4>" ${window.location.origin}/api/v1/sdk/config`
      return (
        <>
          <p className="text-sm text-muted-foreground">Ask for the config from your app, or from a terminal to try it.</p>
          <div className="flex items-start gap-1 rounded-lg border bg-muted py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 py-1 font-mono text-[13px] break-all whitespace-pre-wrap">{curl}</code>
            <CopyButton value={curl} label="Command" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={firstRun.checking} onClick={firstRun.checkAgain}>
              {firstRun.checking && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Check again
            </Button>
            <p className="text-sm text-muted-foreground">
              Waiting for the first request with {key ? <span className="font-medium">{key.name}</span> : 'a key'}. It can
              take a few minutes to show.
            </p>
          </div>
        </>
      )
    }
  }
}
