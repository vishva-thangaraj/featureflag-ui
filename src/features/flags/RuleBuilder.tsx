import { useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { MoreHorizontal, Plus, X } from 'lucide-react'
import { Segmented } from '@/components/Segmented'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  describeRule,
  isMultiValue,
  newRule,
  OPERATOR_LABELS,
  OPERATORS,
  TYPE_LABELS,
  withType,
  type RuleDraft,
  type RuleErrors,
  type RuleValueType,
} from './rules'

interface RuleBuilderProps {
  rules: RuleDraft[]
  errors: Map<string, RuleErrors>
  /** After a save attempt, empty fields count as errors too. */
  showEmptyErrors: boolean
  serverMessage: string | null
  attributes: string[]
  canWrite: boolean
  onChange: (rules: RuleDraft[]) => void
}

/** The rules an environment's users must all match, edited as a draft that is saved with the rollout. */
export function RuleBuilder({ rules, errors, showEmptyErrors, serverMessage, attributes, canWrite, onChange }: RuleBuilderProps) {
  const listId = useId()
  const addRef = useRef<HTMLButtonElement>(null)
  const [added, setAdded] = useState<string | null>(null)

  function add() {
    const rule = newRule()
    setAdded(rule.id)
    onChange([...rules, rule])
  }

  function update(next: RuleDraft) {
    onChange(rules.map((rule) => (rule.id === next.id ? next : rule)))
  }

  function setAttribute(rule: RuleDraft, attribute: string) {
    // A new rule on an attribute this environment already uses starts with that rule's type.
    const known = rules.find((other) => other.id !== rule.id && other.attribute.trim() === attribute.trim())
    const typed = rule.id.startsWith('new-') && known && known.valueType !== rule.valueType
    update(typed ? withType({ ...rule, attribute }, known.valueType) : { ...rule, attribute })
  }

  function move(index: number, step: number) {
    const next = [...rules]
    const [rule] = next.splice(index, 1)
    next.splice(index + step, 0, rule)
    onChange(next)
  }

  function remove(rule: RuleDraft) {
    onChange(rules.filter((other) => other.id !== rule.id))
    addRef.current?.focus()
  }

  return (
    <section aria-labelledby="rules-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="rules-heading" className="text-sm font-semibold text-muted-foreground">
            Targeting rules
          </h2>
          {rules.length > 1 && (
            <p className="text-sm text-muted-foreground">All rules must match. Their order doesn't change who matches.</p>
          )}
        </div>
        {canWrite && (
          <Button ref={addRef} variant="outline" size="sm" onClick={add}>
            <Plus aria-hidden="true" />
            Add rule
          </Button>
        )}
      </div>

      {serverMessage && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverMessage}
        </p>
      )}

      {rules.length === 0 ? (
        <p className="text-muted-foreground">No rules. Everyone in the rollout gets this flag.</p>
      ) : canWrite ? (
        <ol className="flex flex-col gap-2">
          {rules.map((rule, index) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              index={index}
              last={index === rules.length - 1}
              errors={errors.get(rule.id) ?? {}}
              showEmptyErrors={showEmptyErrors}
              listId={listId}
              focusOnMount={rule.id === added}
              onUpdate={update}
              onAttribute={(attribute) => setAttribute(rule, attribute)}
              onMove={(step) => move(index, step)}
              onRemove={() => remove(rule)}
            />
          ))}
        </ol>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {rules.map((rule, index) => (
            <li key={rule.id} className={cn('flex flex-wrap items-center gap-2', !rule.enabled && 'opacity-60')}>
              <span className="w-8 text-sm text-muted-foreground">{index > 0 && 'and'}</span>
              <span className="font-mono text-[13px]">{describeRule({ ...rule, enabled: true })}</span>
              {!rule.enabled && <Badge variant="outline">Paused · not sent to SDKs</Badge>}
            </li>
          ))}
        </ol>
      )}

      <datalist id={listId}>
        {attributes.map((attribute) => (
          <option key={attribute} value={attribute} />
        ))}
      </datalist>
    </section>
  )
}

interface RuleRowProps {
  rule: RuleDraft
  index: number
  last: boolean
  errors: RuleErrors
  showEmptyErrors: boolean
  listId: string
  focusOnMount: boolean
  onUpdate: (rule: RuleDraft) => void
  onAttribute: (attribute: string) => void
  onMove: (step: number) => void
  onRemove: () => void
}

function RuleRow({ rule, index, last, errors, showEmptyErrors, listId, focusOnMount, onUpdate, onAttribute, onMove, onRemove }: RuleRowProps) {
  const attributeRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const number = index + 1

  useEffect(() => {
    if (focusOnMount) {
      attributeRef.current?.focus()
    }
  }, [focusOnMount])

  // An empty field isn't an error until someone tries to save; a wrong value is one at once.
  const attributeError = (showEmptyErrors || rule.attribute.trim() !== '') && errors.attribute
  const valuesError = (showEmptyErrors || rule.values.length > 0) && errors.values
  const messages = [attributeError, valuesError].filter((message): message is string => Boolean(message))

  return (
    <li>
      <fieldset
        aria-describedby={messages.length > 0 ? errorId : undefined}
        className={cn('flex flex-col gap-1.5 rounded-lg border px-2 py-2', !rule.enabled && 'bg-muted/50')}
      >
        <legend className="sr-only">Rule {number}</legend>
        <div className={cn('flex flex-wrap items-start gap-2', !rule.enabled && 'opacity-60')}>
          <span className={cn('flex h-9 w-8 items-center text-sm text-muted-foreground', index === 0 && 'max-sm:hidden')}>
            {index > 0 && 'and'}
          </span>
          {rule.negated && <Badge variant="secondary" className="mt-2 font-mono">NOT</Badge>}
          <Input
            ref={attributeRef}
            list={listId}
            aria-label="Attribute"
            aria-invalid={Boolean(attributeError) || undefined}
            placeholder="attribute"
            autoComplete="off"
            spellCheck={false}
            value={rule.attribute}
            onChange={(event) => onAttribute(event.target.value)}
            className="h-9 w-40 font-mono text-[13px]"
          />
          <NativeSelect
            aria-label="Type"
            value={rule.valueType}
            onChange={(event) => onUpdate(withType(rule, event.target.value as RuleValueType))}
          >
            {(Object.keys(TYPE_LABELS) as RuleValueType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Operator"
            value={rule.operator}
            onChange={(event) => onUpdate({ ...rule, operator: event.target.value as RuleDraft['operator'] })}
          >
            {OPERATORS[rule.valueType].map((operator) => (
              <option key={operator} value={operator}>
                {OPERATOR_LABELS[operator]}
              </option>
            ))}
          </NativeSelect>
          <div className="min-w-40 flex-1">
            <ValueField rule={rule} invalid={Boolean(valuesError)} onValues={(values) => onUpdate({ ...rule, values })} />
          </div>
          {rule.valueType === 'STRING' && rule.caseSensitive && (
            <Badge variant="outline" className="mt-2 font-mono" title="Case-sensitive">
              Aa
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`More options for rule ${number}`} className="size-9">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {rule.valueType === 'STRING' && (
                <DropdownMenuCheckboxItem
                  checked={rule.caseSensitive}
                  onCheckedChange={(checked) => onUpdate({ ...rule, caseSensitive: checked === true })}
                >
                  Case-sensitive
                </DropdownMenuCheckboxItem>
              )}
              <DropdownMenuCheckboxItem
                checked={rule.negated}
                onCheckedChange={(checked) => onUpdate({ ...rule, negated: checked === true })}
              >
                Negate (NOT)
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={() => onUpdate({ ...rule, enabled: !rule.enabled })}>
                {rule.enabled ? 'Pause rule' : 'Resume rule'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
                Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                Delete rule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!rule.enabled && <p className="pl-10 text-sm text-muted-foreground">Paused · not sent to SDKs</p>}
        {messages.length > 0 && (
          <div id={errorId} className="flex flex-col pl-10 text-sm text-destructive">
            {messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
      </fieldset>
    </li>
  )
}

function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30',
        className,
      )}
      {...props}
    />
  )
}

interface ValueFieldProps {
  rule: RuleDraft
  invalid: boolean
  onValues: (values: string[]) => void
}

function ValueField({ rule, invalid, onValues }: ValueFieldProps) {
  if (rule.valueType === 'BOOLEAN') {
    return (
      <Segmented
        label="Value"
        options={[
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ]}
        value={rule.values[0] === 'false' ? 'false' : 'true'}
        onChange={(value) => onValues([value])}
      />
    )
  }
  // Several values under a one-value operator stay as chips, so they can be trimmed rather than lost.
  if (isMultiValue(rule.operator) || rule.values.length > 1) {
    return <ValueChips values={rule.values} invalid={invalid} onValues={onValues} />
  }
  return (
    <Input
      aria-label="Value"
      aria-invalid={invalid || undefined}
      placeholder={rule.valueType === 'SEMVER' ? '2.4.0' : rule.valueType === 'NUMBER' ? '0' : 'value'}
      inputMode={rule.valueType === 'NUMBER' ? 'decimal' : undefined}
      autoComplete="off"
      value={rule.values[0] ?? ''}
      onChange={(event) => onValues(event.target.value === '' ? [] : [event.target.value])}
      className={cn('h-9', rule.valueType !== 'NUMBER' && 'font-mono text-[13px]')}
    />
  )
}

/** Enter or a comma adds a value, a pasted list adds them all, and Backspace in the empty input removes the last. */
function ValueChips({ values, invalid, onValues }: { values: string[]; invalid: boolean; onValues: (values: string[]) => void }) {
  const [text, setText] = useState('')

  function add(raw: string) {
    const parts = raw
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter((part, position, all) => part !== '' && !values.includes(part) && all.indexOf(part) === position)
    setText('')
    if (parts.length > 0) {
      onValues([...values, ...parts])
    }
  }

  return (
    <div
      data-invalid={invalid || undefined}
      className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-invalid:border-destructive dark:bg-input/30"
    >
      {values.map((value, position) => (
        <span key={`${position}-${value}`} className="inline-flex items-center gap-0.5 rounded-md bg-muted py-0.5 pl-1.5 font-mono text-xs">
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => onValues(values.filter((_, other) => other !== position))}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label="Values"
        aria-invalid={invalid || undefined}
        placeholder={values.length === 0 ? 'Type a value, then Enter' : ''}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          // A comma ends a value however it was typed; some keyboards send no keydown for it.
          const next = event.target.value
          const cut = next.lastIndexOf(',')
          if (cut === -1) {
            setText(next)
          } else {
            add(next.slice(0, cut))
            setText(next.slice(cut + 1))
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add(text)
          } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
            onValues(values.slice(0, -1))
          }
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text')
          if (/[,\n]/.test(pasted)) {
            event.preventDefault()
            add(text + pasted)
          }
        }}
        onBlur={() => add(text)}
        className="h-7 min-w-24 flex-1 bg-transparent px-1 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
      />
    </div>
  )
}
