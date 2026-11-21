import { describe, expect, it } from 'vitest'
import { suggestFlagKey } from './keys'

describe('suggestFlagKey', () => {
  it.each([
    ['Checkout V2', 'checkout_v2'],
    ['  New onboarding flow ', 'new_onboarding_flow'],
    ['pricing/experiment', 'pricing_experiment'],
    ['Dark mode!!', 'dark_mode'],
  ])('%j → %s', (input, expected) => {
    expect(suggestFlagKey(input)).toBe(expected)
  })

  it.each([
    ['checkout_v2', 'already valid'],
    ['2fa login', 'cannot start with a letter without changing its meaning'],
    ['!!!', 'nothing left'],
  ])('offers nothing for %j (%s)', (input) => {
    expect(suggestFlagKey(input)).toBeNull()
  })
})
