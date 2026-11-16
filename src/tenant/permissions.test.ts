import { describe, expect, it } from 'vitest'
import { can } from './permissions'

const tenantWith = (...roles: string[]) => ({
  id: '461168601842738689',
  name: 'Acme',
  plan: 'FREE' as const,
  roles: roles.map((name, index) => ({ id: String(index), name })),
})

describe('can', () => {
  it.each([
    ['OWNER', true, true],
    ['ADMIN', true, false],
    ['MEMBER', false, false],
    ['VIEWER', false, false],
  ])('%s: write %s, manage the organization %s', (role, write, manage) => {
    expect(can(tenantWith(role), 'write')).toBe(write)
    expect(can(tenantWith(role), 'manageOrganization')).toBe(manage)
  })

  it('offers nothing to a membership with no roles', () => {
    expect(can(tenantWith(), 'write')).toBe(false)
  })
})
