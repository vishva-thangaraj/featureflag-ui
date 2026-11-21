import { describe, expect, it } from 'vitest'
import {
  contradictions,
  describeRule,
  listRuleChanges,
  OPERATORS,
  ruleChanges,
  ruleErrors,
  sameRules,
  summarizeRuleChanges,
  toRequest,
  withType,
  type RuleDraft,
} from './rules'

function rule(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return {
    id: 'r1',
    attribute: 'plan',
    valueType: 'STRING',
    operator: 'EQUALS',
    values: ['pro'],
    caseSensitive: false,
    negated: false,
    enabled: true,
    ...overrides,
  }
}

describe('operators and types', () => {
  it('offers only the operators the server accepts for each type', () => {
    expect(OPERATORS.BOOLEAN).toEqual(['EQUALS', 'NOT_EQUALS'])
    expect(OPERATORS.NUMBER).not.toContain('CONTAINS')
    expect(OPERATORS.STRING).not.toContain('GT')
    expect(OPERATORS.SEMVER).toContain('SEMVER_GTE')
  })

  it('keeps the operator and values across a type change where they still apply', () => {
    expect(withType(rule({ operator: 'IN', values: ['1', '2'] }), 'NUMBER')).toMatchObject({ operator: 'IN', values: ['1', '2'] })
    expect(withType(rule({ operator: 'CONTAINS' }), 'NUMBER').operator).toBe('EQUALS')
    expect(withType(rule(), 'BOOLEAN').values).toEqual(['true'])
    expect(withType(rule({ valueType: 'BOOLEAN', values: ['false'] }), 'STRING').values).toEqual([])
  })
})

describe('toRequest', () => {
  it('sends typed values, the position as priority, and case sensitivity only for text', () => {
    expect(toRequest(rule({ valueType: 'NUMBER', operator: 'IN', values: [' 5', '7.5'], caseSensitive: true }), 2)).toEqual({
      attribute: 'plan',
      operator: 'IN',
      valueType: 'NUMBER',
      values: [5, 7.5],
      caseSensitive: false,
      negated: false,
      enabled: true,
      priority: 2,
    })
    expect(toRequest(rule({ valueType: 'BOOLEAN', values: ['false'] }), 0).values).toEqual([false])
    expect(toRequest(rule({ attribute: ' country ' }), 0).attribute).toBe('country')
  })

  it('treats a rule set as unchanged when only untyped whitespace differs', () => {
    expect(sameRules([rule({ values: ['pro '] })], [rule()])).toBe(true)
    expect(sameRules([rule(), rule({ id: 'r2', attribute: 'country' })], [rule({ id: 'r2', attribute: 'country' }), rule()])).toBe(false)
  })
})

describe('ruleErrors', () => {
  it.each([
    [rule({ attribute: '' }), { attribute: 'Enter an attribute, like country or plan.' }],
    [rule({ attribute: '1plan' }), { attribute: "Start with a letter, then use only letters, digits, '_' or '.'." }],
    [rule({ values: [] }), { values: 'Enter a value.' }],
    [rule({ operator: 'IN', values: [] }), { values: 'Add at least one value.' }],
    [rule({ values: ['free', 'pro', 'team'] }), { values: "'is' takes one value. Remove 2, or use 'is one of'." }],
    [rule({ operator: 'CONTAINS', values: ['a', 'b'] }), { values: "'contains' takes one value. Remove 1." }],
    [rule({ valueType: 'NUMBER', values: ['ten'] }), { values: '"ten" isn\'t a number.' }],
    [rule({ valueType: 'SEMVER', operator: 'SEMVER_GTE', values: ['2.x'] }), { values: '"2.x" isn\'t a version, like 2.4.0.' }],
    [rule({ valueType: 'SEMVER', operator: 'SEMVER_GTE', values: ['2.4.0-beta.1'] }), {}],
    [rule({ valueType: 'NUMBER', operator: 'IN', values: ['-3', '4.5'] }), {}],
  ])('%#', (draft, expected) => {
    expect(ruleErrors(draft)).toEqual(expected)
  })
})

describe('contradictions', () => {
  it('flags both rows when one attribute must equal two values', () => {
    const found = contradictions([rule({ id: 'a', values: ['free'] }), rule({ id: 'b', values: ['pro'] })])
    expect(found.get('a')).toBe("Can't match together with rule 2: plan can't be both free and pro.")
    expect(found.get('b')).toBe("Can't match together with rule 1: plan can't be both free and pro.")
  })

  it('flags a value that is both required and ruled out, negation included', () => {
    expect(contradictions([rule({ id: 'a' }), rule({ id: 'b', operator: 'NOT_EQUALS' })]).size).toBe(2)
    expect(contradictions([rule({ id: 'a' }), rule({ id: 'b', negated: true })]).size).toBe(2)
  })

  it.each([
    ['two "is not" rules', [rule({ id: 'a', operator: 'NOT_EQUALS', values: ['free'] }), rule({ id: 'b', operator: 'NOT_EQUALS' })]],
    ['the same value in another case', [rule({ id: 'a', values: ['Pro'] }), rule({ id: 'b' })]],
    ['a paused rule', [rule({ id: 'a', values: ['free'], enabled: false }), rule({ id: 'b' })]],
    ['different attributes', [rule({ id: 'a', attribute: 'tier', values: ['free'] }), rule({ id: 'b' })]],
    ['different types', [rule({ id: 'a', valueType: 'NUMBER', values: ['1'] }), rule({ id: 'b' })]],
  ])('allows %s', (_name, rules) => {
    expect(contradictions(rules).size).toBe(0)
  })

  it('compares case-sensitive values exactly', () => {
    const rules = [rule({ id: 'a', values: ['Pro'], caseSensitive: true }), rule({ id: 'b', caseSensitive: true })]
    expect(contradictions(rules).size).toBe(2)
  })
})

describe('describing changes', () => {
  it('reads a rule as a sentence', () => {
    expect(describeRule(rule({ attribute: 'country', operator: 'IN', values: ['IN', 'US'] }))).toBe('country is one of IN, US')
    expect(describeRule(rule({ negated: true, caseSensitive: true, enabled: false }))).toBe('NOT plan is pro (case-sensitive, paused)')
    expect(describeRule(rule({ valueType: 'SEMVER', operator: 'SEMVER_GTE', attribute: 'appVersion', values: ['2.4.0'] }))).toBe(
      'appVersion at least 2.4.0',
    )
  })

  it('lists what was added, removed, changed and reordered', () => {
    const from = [rule({ id: 'a' }), rule({ id: 'b', attribute: 'country' }), rule({ id: 'c', attribute: 'tier' })]
    const to = [rule({ id: 'c', attribute: 'tier' }), rule({ id: 'a', values: ['team'] }), rule({ id: 'new-1', attribute: 'beta', valueType: 'BOOLEAN', values: ['true'] })]
    const changes = ruleChanges(from, to)

    expect(summarizeRuleChanges(changes)).toEqual(['1 rule added', '1 rule removed', '1 rule changed', 'Rules reordered'])
    expect(listRuleChanges(changes)).toEqual([
      'Added: beta is true',
      'Removed: country is pro',
      'Changed: plan is pro → plan is team',
      'Rules reordered',
    ])
  })

  it('does not call a deletion a reorder', () => {
    const from = [rule({ id: 'a' }), rule({ id: 'b' }), rule({ id: 'c' })]
    expect(ruleChanges(from, [from[0], from[2]]).reordered).toBe(false)
  })
})
