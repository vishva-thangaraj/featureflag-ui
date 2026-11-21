import { describe, expect, it } from 'vitest'
import { describeEffect } from './effect'
import type { FlagConfig } from './queries'

function config(overrides: Partial<FlagConfig> & { ruleCount?: number } = {}): FlagConfig {
  const { ruleCount = 0, ...rest } = overrides
  return {
    featureKey: 'checkout_v2',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 100,
    enabledUsers: [],
    disabledUsers: [],
    rules: Array.from({ length: ruleCount }, (_, index) => ({
      id: String(index),
      attribute: 'country',
      operator: 'IN' as const,
      valueType: 'STRING' as const,
      values: ['IN'],
      caseSensitive: false,
      negated: false,
      enabled: true,
      priority: index,
    })),
    lastModified: '2026-11-21T00:00:00Z',
    ...rest,
  }
}

describe('describeEffect', () => {
  it.each([
    ['not set up', null, "Not set up in production. SDKs don't receive it."],
    ['off', config({ enabled: false, ruleCount: 2, enabledUsers: ['a'] }), 'Off for everyone in production.'],
    ['on for everyone', config(), 'On for everyone in production.'],
    ['on for everyone, allowed users included', config({ enabledUsers: ['a', 'b'] }), 'On for everyone in production.'],
    ['everyone but a denied user', config({ disabledUsers: ['z'] }), 'On for everyone in production. 1 user never gets it.'],
    ['0% and nobody allowed', config({ rolloutPercentage: 0, disabledUsers: ['z'] }), 'On, but at 0% nobody gets it.'],
    ['0% with allowed users', config({ rolloutPercentage: 0, enabledUsers: ['a', 'b'] }), 'On, but at 0% only 2 allowed users get it.'],
    ['0% with one allowed user', config({ rolloutPercentage: 0, enabledUsers: ['a'] }), 'On, but at 0% only 1 allowed user gets it.'],
    ['a rollout alone', config({ rolloutPercentage: 25 }), 'On for 25% of users.'],
    ['one rule', config({ ruleCount: 1 }), 'On for users who match its rule.'],
    ['three rules at half', config({ ruleCount: 3, rolloutPercentage: 50 }), 'On for 50% of users who match all 3 rules.'],
    [
      'the full picture',
      config({ ruleCount: 2, rolloutPercentage: 25, enabledUsers: ['a', 'b', 'c'], disabledUsers: ['z'] }),
      'On for 3 allowed users, and for 25% of users who match both rules. 1 user never gets it.',
    ],
  ])('%s', (_case, flagConfig, expected) => {
    expect(describeEffect(flagConfig, 'production')).toBe(expected)
  })

  it('leaves paused rules out, as SDKs never see them', () => {
    const flagConfig = config({ ruleCount: 2 })
    flagConfig.rules[1] = { ...flagConfig.rules[1], enabled: false }

    expect(describeEffect(flagConfig, 'production')).toBe('On for users who match its rule.')
  })
})
