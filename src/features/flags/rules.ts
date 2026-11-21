import type { components } from '@/api/schema'

export type Rule = components['schemas']['RuleResponse']
export type RuleRequest = Required<components['schemas']['RuleRequest']>
export type RuleOperator = Rule['operator']
export type RuleValueType = Rule['valueType']

/** A rule as edited: values stay the text that was typed until they are sent. */
export interface RuleDraft {
  /** The server's id, or a local one for a rule added in this draft. */
  id: string
  attribute: string
  valueType: RuleValueType
  operator: RuleOperator
  values: string[]
  caseSensitive: boolean
  negated: boolean
  enabled: boolean
}

export interface RuleErrors {
  attribute?: string
  values?: string
}

export const TYPE_LABELS: Record<RuleValueType, string> = {
  STRING: 'Text',
  NUMBER: 'Number',
  BOOLEAN: 'True/false',
  SEMVER: 'Version',
}

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  EQUALS: 'is',
  NOT_EQUALS: 'is not',
  IN: 'is one of',
  NOT_IN: 'is not one of',
  CONTAINS: 'contains',
  STARTS_WITH: 'starts with',
  ENDS_WITH: 'ends with',
  GT: 'greater than',
  GTE: 'at least',
  LT: 'less than',
  LTE: 'at most',
  SEMVER_GT: 'newer than',
  SEMVER_GTE: 'at least',
  SEMVER_LT: 'older than',
  SEMVER_LTE: 'at most',
}

/** Only the operators the server accepts for each type, so an invalid pairing can't be built. */
export const OPERATORS: Record<RuleValueType, RuleOperator[]> = {
  STRING: ['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH'],
  NUMBER: ['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'GT', 'GTE', 'LT', 'LTE'],
  BOOLEAN: ['EQUALS', 'NOT_EQUALS'],
  SEMVER: ['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'SEMVER_GT', 'SEMVER_GTE', 'SEMVER_LT', 'SEMVER_LTE'],
}

const ATTRIBUTE = /^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/
const SEMVER = /^\d+(\.\d+){0,3}([-+].*)?$/
const NUMBER = /^-?\d+(\.\d+)?$/

export const isMultiValue = (operator: RuleOperator) => operator === 'IN' || operator === 'NOT_IN'

let nextLocalId = 0

export function newRule(): RuleDraft {
  nextLocalId += 1
  return {
    id: `new-${nextLocalId}`,
    attribute: '',
    valueType: 'STRING',
    operator: 'EQUALS',
    values: [],
    caseSensitive: false,
    negated: false,
    enabled: true,
  }
}

export function fromRule(rule: Rule): RuleDraft {
  return {
    id: rule.id,
    attribute: rule.attribute,
    valueType: rule.valueType,
    operator: rule.operator,
    values: rule.values.map(String),
    caseSensitive: rule.caseSensitive,
    negated: rule.negated,
    enabled: rule.enabled,
  }
}

/** A new type keeps the operator where it still applies, and the values unless they can't carry over. */
export function withType(rule: RuleDraft, valueType: RuleValueType): RuleDraft {
  const operator = OPERATORS[valueType].includes(rule.operator) ? rule.operator : 'EQUALS'
  const values = valueType === 'BOOLEAN' ? ['true'] : rule.valueType === 'BOOLEAN' ? [] : rule.values
  return { ...rule, valueType, operator, values }
}

function typedValue(value: string, valueType: RuleValueType): unknown {
  const trimmed = value.trim()
  if (valueType === 'NUMBER') {
    return Number(trimmed)
  }
  if (valueType === 'BOOLEAN') {
    return trimmed === 'true'
  }
  return trimmed
}

/** The body the server takes. Priority is the position, so the order people read is the order saved. */
export function toRequest(rule: RuleDraft, index: number): RuleRequest {
  return {
    attribute: rule.attribute.trim(),
    operator: rule.operator,
    valueType: rule.valueType,
    values: rule.values.map((value) => typedValue(value, rule.valueType)),
    caseSensitive: rule.valueType === 'STRING' && rule.caseSensitive,
    negated: rule.negated,
    enabled: rule.enabled,
    priority: index,
  }
}

const canonical = (rules: RuleDraft[]) => JSON.stringify(rules.map(toRequest))

export const sameRules = (a: RuleDraft[], b: RuleDraft[]) => canonical(a) === canonical(b)

function singleValueHint(operator: RuleOperator, extra: number): string {
  const label = OPERATOR_LABELS[operator]
  const remove = `remove ${extra}`
  if (operator === 'EQUALS' || operator === 'NOT_EQUALS') {
    return `'${label}' takes one value. ${capitalize(remove)}, or use '${OPERATOR_LABELS[operator === 'EQUALS' ? 'IN' : 'NOT_IN']}'.`
  }
  return `'${label}' takes one value. ${capitalize(remove)}.`
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The checks the server makes on one rule, so they show while typing rather than after a save. */
export function ruleErrors(rule: RuleDraft): RuleErrors {
  const errors: RuleErrors = {}
  const attribute = rule.attribute.trim()
  if (attribute === '') {
    errors.attribute = 'Enter an attribute, like country or plan.'
  } else if (!ATTRIBUTE.test(attribute)) {
    errors.attribute = "Start with a letter, then use only letters, digits, '_' or '.'."
  }

  const values = rule.values.map((value) => value.trim())
  if (values.length === 0 || values.every((value) => value === '')) {
    errors.values = isMultiValue(rule.operator) ? 'Add at least one value.' : 'Enter a value.'
  } else if (!isMultiValue(rule.operator) && values.length > 1) {
    errors.values = singleValueHint(rule.operator, values.length - 1)
  } else if (rule.valueType === 'NUMBER') {
    const bad = values.find((value) => !NUMBER.test(value))
    if (bad !== undefined) {
      errors.values = `"${bad}" isn't a number.`
    }
  } else if (rule.valueType === 'SEMVER') {
    const bad = values.find((value) => !SEMVER.test(value))
    if (bad !== undefined) {
      errors.values = `"${bad}" isn't a version, like 2.4.0.`
    }
  }
  return errors
}

const hasErrors = (errors: RuleErrors) => errors.attribute !== undefined || errors.values !== undefined

function sameValue(a: RuleDraft, b: RuleDraft): boolean {
  const left = a.values[0].trim()
  const right = b.values[0].trim()
  if (a.valueType === 'NUMBER') {
    return Number(left) === Number(right)
  }
  if (a.valueType === 'STRING' && !(a.caseSensitive && b.caseSensitive)) {
    return left.toLowerCase() === right.toLowerCase()
  }
  return left === right
}

/**
 * The contradictions the server refuses with 409 that are plain from two rows: one attribute that has to
 * equal two different values, or equal and not equal the same one. Both rows get the message.
 */
export function contradictions(rules: RuleDraft[]): Map<string, string> {
  const found = new Map<string, string>()
  const candidates = rules
    .map((rule, index) => ({ rule, index }))
    .filter(
      ({ rule }) =>
        rule.enabled &&
        (rule.operator === 'EQUALS' || rule.operator === 'NOT_EQUALS') &&
        !hasErrors(ruleErrors(rule)),
    )

  for (const [position, first] of candidates.entries()) {
    for (const second of candidates.slice(position + 1)) {
      const a = first.rule
      const b = second.rule
      if (a.attribute.trim() !== b.attribute.trim() || a.valueType !== b.valueType) {
        continue
      }
      const aWantsEqual = a.negated !== (a.operator === 'EQUALS')
      const bWantsEqual = b.negated !== (b.operator === 'EQUALS')
      const equal = sameValue(a, b)
      let reason: string | undefined
      if (aWantsEqual && bWantsEqual && !equal) {
        reason = `${a.attribute.trim()} can't be both ${a.values[0].trim()} and ${b.values[0].trim()}.`
      } else if (aWantsEqual !== bWantsEqual && equal) {
        reason = `one requires ${a.values[0].trim()} and the other rules it out.`
      }
      if (reason) {
        found.set(a.id, found.get(a.id) ?? `Can't match together with rule ${second.index + 1}: ${reason}`)
        found.set(b.id, found.get(b.id) ?? `Can't match together with rule ${first.index + 1}: ${reason}`)
      }
    }
  }
  return found
}

/** Every problem in a rule set, by rule id. Empty when it can be sent. */
export function ruleSetErrors(rules: RuleDraft[]): Map<string, RuleErrors> {
  const errors = new Map<string, RuleErrors>()
  const conflicts = contradictions(rules)
  for (const rule of rules) {
    const own = ruleErrors(rule)
    const conflict = conflicts.get(rule.id)
    if (conflict && own.values === undefined) {
      own.values = conflict
    }
    if (hasErrors(own)) {
      errors.set(rule.id, own)
    }
  }
  return errors
}

/** A rule as a sentence: `country is one of IN, US`. */
export function describeRule(rule: RuleDraft): string {
  const values = rule.values.map((value) => value.trim()).join(', ')
  const attribute = rule.attribute.trim() || '(no attribute)'
  const sentence = `${rule.negated ? 'NOT ' : ''}${attribute} ${OPERATOR_LABELS[rule.operator]} ${values}`.trim()
  const notes = [rule.valueType === 'STRING' && rule.caseSensitive && 'case-sensitive', !rule.enabled && 'paused']
    .filter(Boolean)
    .join(', ')
  return notes ? `${sentence} (${notes})` : sentence
}

export interface RuleChanges {
  added: RuleDraft[]
  removed: RuleDraft[]
  changed: { before: RuleDraft; after: RuleDraft }[]
  reordered: boolean
}

export function ruleChanges(from: RuleDraft[], to: RuleDraft[]): RuleChanges {
  const before = new Map(from.map((rule) => [rule.id, rule]))
  const after = new Map(to.map((rule) => [rule.id, rule]))
  const kept = to.filter((rule) => before.has(rule.id)).map((rule) => rule.id)
  return {
    added: to.filter((rule) => !before.has(rule.id)),
    removed: from.filter((rule) => !after.has(rule.id)),
    changed: to
      .filter((rule) => before.has(rule.id) && !sameRules([before.get(rule.id)!], [rule]))
      .map((rule) => ({ before: before.get(rule.id)!, after: rule })),
    reordered: kept.join() !== from.filter((rule) => after.has(rule.id)).map((rule) => rule.id).join(),
  }
}

const count = (n: number, what: string) => `${n} rule${n === 1 ? '' : 's'} ${what}`

/** The short form for the save bar: `1 rule added · 1 rule changed`. */
export function summarizeRuleChanges(changes: RuleChanges): string[] {
  return [
    changes.added.length > 0 && count(changes.added.length, 'added'),
    changes.removed.length > 0 && count(changes.removed.length, 'removed'),
    changes.changed.length > 0 && count(changes.changed.length, 'changed'),
    changes.reordered && 'Rules reordered',
  ].filter((part): part is string => typeof part === 'string')
}

/** The long form for the review: one line per rule. */
export function listRuleChanges(changes: RuleChanges): string[] {
  return [
    ...changes.added.map((rule) => `Added: ${describeRule(rule)}`),
    ...changes.removed.map((rule) => `Removed: ${describeRule(rule)}`),
    ...changes.changed.map(({ before, after }) => `Changed: ${describeRule(before)} → ${describeRule(after)}`),
    ...(changes.reordered ? ['Rules reordered'] : []),
  ]
}
