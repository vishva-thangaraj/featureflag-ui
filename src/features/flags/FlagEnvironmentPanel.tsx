import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/errors'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isProtectedEnvironment, type Environment } from '@/features/environments/queries'
import { fallbackMessage } from '@/lib/form-errors'
import { describeEffect } from './effect'
import { FlagSwitch } from './FlagSwitch'
import { OverrideTable } from './OverrideTable'
import { RuleBuilder } from './RuleBuilder'
import { SdkPayload } from './SdkPayload'
import {
  useFlagConfigFor,
  useFlagRules,
  useReplaceRules,
  useRuleAttributes,
  useSaveFlagState,
  type Feature,
} from './queries'
import {
  fromRule,
  listRuleChanges,
  ruleChanges,
  ruleSetErrors,
  sameRules,
  summarizeRuleChanges,
  toRequest,
  type RuleDraft,
  type RuleErrors,
} from './rules'

interface FlagEnvironmentPanelProps {
  feature: Feature
  environment: Environment
  canWrite: boolean
}

/** What is being edited, each with the saved value it started from. */
interface Draft {
  rollout: { from: number; to: number } | null
  rules: { from: RuleDraft[]; to: RuleDraft[] } | null
}

const NO_DRAFT: Draft = { rollout: null, rules: null }

function failureMessage(error: unknown): string {
  if (error instanceof ApiError && error.retryAfter) {
    return `Too many changes at once. Try again in ${error.retryAfter} s.`
  }
  return fallbackMessage(error)
}

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)))

const rolloutChanged = (draft: Draft) => draft.rollout !== null && draft.rollout.to !== draft.rollout.from
const rulesChanged = (draft: Draft) => draft.rules !== null && !sameRules(draft.rules.from, draft.rules.to)

/** Field errors arrive as `rules[1].attribute`; each goes on the row it names. */
function rowErrors(error: unknown, rules: RuleDraft[]): Map<string, RuleErrors> {
  const rows = new Map<string, RuleErrors>()
  const fieldErrors = error instanceof ApiError ? (error.body?.fieldErrors ?? []) : []
  for (const { field, message } of fieldErrors) {
    const [, index, name] = field?.match(/^rules\[(\d+)\]\.(\w+)/) ?? []
    const rule = index === undefined ? undefined : rules[Number(index)]
    if (rule) {
      const errors = rows.get(rule.id) ?? {}
      if (name === 'attribute') {
        errors.attribute ??= message
      } else {
        errors.values ??= message
      }
      rows.set(rule.id, errors)
    }
  }
  return rows
}

/**
 * One environment's view of a flag. The switch and the overrides apply at once; the rollout and the
 * rules are a draft saved together, because they change in steps and a protected environment shows
 * the change before it goes out.
 */
export function FlagEnvironmentPanel({ feature, environment, canWrite }: FlagEnvironmentPanelProps) {
  const config = useFlagConfigFor(feature.key, environment.name)
  const rulesQuery = useFlagRules(feature.id, environment.id, Boolean(config.data))
  const attributes = useRuleAttributes(feature.id)
  const saveState = useSaveFlagState(feature.id)
  const replaceRules = useReplaceRules(feature.id, environment.id)
  const rulesRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState<Draft>(NO_DRAFT)
  const [reviewing, setReviewing] = useState(false)
  const [conflict, setConflict] = useState<{ rollout: number | null; rules: boolean } | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [serverRuleErrors, setServerRuleErrors] = useState<Map<string, RuleErrors>>(new Map())
  const [rulesMessage, setRulesMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isProtected = isProtectedEnvironment(environment.name)
  const rolloutDirty = rolloutChanged(draft)
  const rulesDirty = rulesChanged(draft)
  const dirty = rolloutDirty || rulesDirty

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !(nextLocation.state as { discardDraft?: boolean } | null)?.discardDraft &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  )

  useEffect(() => {
    if (!dirty) {
      return
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (config.isPending) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3 py-2">
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }
  if (config.isError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
        <p>Couldn't load {feature.key} in {environment.name}.</p>
        <Button variant="outline" onClick={() => void config.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const saved = config.data
  const savedRules = (rulesQuery.data ?? []).map(fromRule)
  const rules = rulesDirty ? draft.rules!.to : savedRules
  const rollout = rolloutDirty ? draft.rollout!.to : (saved?.rolloutPercentage ?? 100)
  const shown = saved && {
    ...saved,
    rolloutPercentage: rollout,
    rules: rulesDirty ? rules.map((rule, index) => ({ id: rule.id, ...toRequest(rule, index) })) : saved.rules,
  }
  const effect = describeEffect(shown ?? null, environment.name)
  const changesOutcome = dirty && effect !== describeEffect(saved ?? null, environment.name)
  const changes = rulesDirty ? ruleChanges(draft.rules!.from, draft.rules!.to) : null

  const errors = ruleSetErrors(rules)
  for (const [id, own] of serverRuleErrors) {
    errors.set(id, { ...own, ...errors.get(id) })
  }
  const blockingErrors = rulesDirty && errors.size > 0

  function changeRollout(value: number) {
    if (!saved || Number.isNaN(value)) {
      return
    }
    const from = saved.rolloutPercentage
    setDraft((current) => ({
      ...current,
      rollout: { from: rolloutChanged(current) ? current.rollout!.from : from, to: clamp(value) },
    }))
  }

  function changeRules(next: RuleDraft[]) {
    setDraft((current) => ({
      ...current,
      rules: { from: rulesChanged(current) ? current.rules!.from : savedRules, to: next },
    }))
    setServerRuleErrors(new Map())
  }

  function discard() {
    setDraft(NO_DRAFT)
    setConflict(null)
    setAttempted(false)
    setServerRuleErrors(new Map())
    setRulesMessage(null)
  }

  function setUp() {
    saveState.mutate(
      { envId: environment.id, enabled: false },
      {
        onSuccess: () => toast.success(`Set up in ${environment.name}. It's off until you turn it on.`),
        onError: (error) => toast.error(`Couldn't set up ${feature.key}. ${failureMessage(error)}`),
      },
    )
  }

  function save() {
    if (blockingErrors) {
      setAttempted(true)
      requestAnimationFrame(() => rulesRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    if (isProtected) {
      setReviewing(true)
    } else {
      void commit(false)
    }
  }

  async function commit(overwrite: boolean) {
    const pending = draft
    const savingRollout = rolloutChanged(pending)
    const savingRules = rulesChanged(pending)
    setReviewing(false)
    setSaving(true)
    try {
      // Read both again: on/off is sent with the rollout and must not undo someone's switch, and a
      // rule set saved meanwhile would be silently replaced.
      const [fresh, freshRules] = await Promise.all([config.refetch(), savingRules ? rulesQuery.refetch() : null])
      const readError = fresh.error ?? freshRules?.error
      if (readError) {
        toast.error(`Couldn't save. ${failureMessage(readError)}`)
        return
      }
      if (!fresh.data) {
        discard()
        toast.error(`${feature.key} is no longer set up in ${environment.name}.`)
        return
      }
      if (!overwrite) {
        const theirRollout =
          savingRollout && fresh.data.rolloutPercentage !== pending.rollout!.from ? fresh.data.rolloutPercentage : null
        const theirRules = savingRules && !sameRules((freshRules?.data ?? []).map(fromRule), pending.rules!.from)
        if (theirRollout !== null || theirRules) {
          setConflict({ rollout: theirRollout, rules: theirRules })
          return
        }
      }
      setConflict(null)

      if (savingRollout) {
        try {
          await saveState.mutateAsync({
            envId: environment.id,
            enabled: fresh.data.enabled,
            rolloutPercentage: pending.rollout!.to,
          })
          setDraft((current) => ({ ...current, rollout: null }))
        } catch (error) {
          toast.error(`Couldn't save. ${failureMessage(error)}`)
          return
        }
      }
      if (savingRules) {
        try {
          await replaceRules.mutateAsync(pending.rules!.to.map(toRequest))
          setDraft((current) => ({ ...current, rules: null }))
          setAttempted(false)
          setRulesMessage(null)
        } catch (error) {
          const rows = rowErrors(error, pending.rules!.to)
          const reason = rows.size > 0 ? 'Fix the highlighted rules.' : failureMessage(error)
          setServerRuleErrors(rows)
          setAttempted(rows.size > 0)
          setRulesMessage(savingRollout ? `Rollout saved. Rules weren't: ${reason}` : `Rules weren't saved: ${reason}`)
          rulesRef.current?.scrollIntoView?.({ block: 'nearest' })
          return
        }
      }
      toast.success(
        savingRollout && savingRules
          ? `Rollout and rules saved in ${environment.name}`
          : savingRollout
            ? `Rollout saved: ${pending.rollout!.to}% in ${environment.name}`
            : `Rules saved in ${environment.name}`,
      )
    } finally {
      setSaving(false)
    }
  }

  const enabledRules = shown?.rules.filter((rule) => rule.enabled).length ?? 0
  const changeLines = [
    ...(rolloutDirty ? [`Rollout ${draft.rollout!.from}% → ${draft.rollout!.to}%`] : []),
    ...(changes ? summarizeRuleChanges(changes) : []),
  ]

  return (
    <div className="flex flex-col gap-5 py-2">
      <p aria-live="polite" className="text-base font-medium">
        {changesOutcome && <span className="text-muted-foreground">After saving: </span>}
        {effect}
      </p>

      <section aria-labelledby="status-heading" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <h2 id="status-heading" className="text-sm font-semibold text-muted-foreground">
          Status
        </h2>
        {saved ? (
          <>
            <FlagSwitch feature={feature} environment={environment} enabled={saved.enabled} canWrite={canWrite} />
            <p className="text-sm text-muted-foreground">
              {saved.enabled
                ? `Turning it off stops it for everyone in ${environment.name}, allowed users included.`
                : 'Off for everyone. Turning it on applies the rollout below.'}
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-ink-secondary">Not set up in {environment.name}.</p>
            {canWrite && (
              <Button variant="outline" onClick={setUp} disabled={saveState.isPending}>
                {saveState.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                Set up in {environment.name}
              </Button>
            )}
          </div>
        )}
      </section>

      {saved && (
        <section aria-labelledby="rollout-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <h2 id="rollout-heading" className="text-sm font-semibold text-muted-foreground">
            Rollout
          </h2>
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-4">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={rollout}
                aria-label="Rollout"
                aria-valuetext={`${rollout}%`}
                onChange={(event) => changeRollout(Number(event.target.value))}
                className="h-2 w-full max-w-md cursor-pointer accent-primary"
              />
              <span className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  aria-label="Rollout percentage"
                  value={rollout}
                  onChange={(event) => changeRollout(Number(event.target.value))}
                  className="h-9 w-20 tabular-nums"
                />
                <span aria-hidden="true">%</span>
              </span>
            </div>
          ) : (
            <p className="text-lg font-medium tabular-nums">{saved.rolloutPercentage}%</p>
          )}
          <p className="text-sm text-muted-foreground">
            {rollout === 0
              ? '0% means nobody, even while the flag is on.'
              : enabledRules > 0
                ? 'Of users who match the rules. Allowed users always get it.'
                : 'Of users not on the allow or deny list.'}
          </p>
        </section>
      )}

      {saved && (
        <div ref={rulesRef}>
          {rulesQuery.isPending ? (
            <div role="status" aria-label="Loading rules" className="h-28 animate-pulse rounded-xl bg-muted" />
          ) : rulesQuery.isError ? (
            <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
              <p>Couldn't load the rules.</p>
              <Button variant="outline" size="sm" onClick={() => void rulesQuery.refetch()}>
                Try again
              </Button>
            </section>
          ) : (
            <RuleBuilder
              rules={rules}
              errors={errors}
              showEmptyErrors={attempted}
              serverMessage={rulesMessage}
              attributes={attributes.data ?? []}
              canWrite={canWrite}
              onChange={changeRules}
            />
          )}
        </div>
      )}

      {saved && <OverrideTable feature={feature} environment={environment} canWrite={canWrite} />}

      <SdkPayload config={saved} envName={environment.name} />

      {dirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-overlay"
        >
          <span className="flex flex-wrap items-center gap-2">
            <Badge className="bg-warning-soft text-warning">Unsaved changes</Badge>
            <span className="tabular-nums">{changeLines.join(' · ')}</span>
            {attempted && blockingErrors && (
              <span role="alert" className="text-sm text-destructive">
                Fix the highlighted rules to save.
              </span>
            )}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={discard}>
              Discard
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {isProtected ? 'Review and save' : 'Save'}
            </Button>
          </span>
        </div>
      )}

      <AlertDialog open={reviewing} onOpenChange={setReviewing}>
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            // Reversible, so Enter may confirm: focus the action, not Cancel.
            event.preventDefault()
            confirmRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes to {environment.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {environment.name} is protected. SDKs pick up the change on their next poll.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm tabular-nums">
            {rolloutDirty && (
              <li>
                Rollout {draft.rollout!.from}% → {draft.rollout!.to}%
              </li>
            )}
            {changes && listRuleChanges(changes).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button ref={confirmRef} onClick={() => void commit(false)}>
              Save to {environment.name}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Someone changed this flag while you were editing</AlertDialogTitle>
            <AlertDialogDescription>
              {conflict && conflict.rollout !== null && `The rollout in ${environment.name} is now ${conflict.rollout}%. `}
              {conflict?.rules && `The rules in ${environment.name} were changed. `}
              Saving yours replaces their changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={discard}>Discard mine</AlertDialogCancel>
            <Button onClick={() => void commit(true)}>Save mine anyway</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.state === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your changes in {environment.name} haven't been saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button variant="outline" onClick={() => blocker.proceed?.()}>
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
