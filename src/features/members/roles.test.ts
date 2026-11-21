import { describe, expect, it } from 'vitest'
import { grantableRoles, highestRole, roleLabel } from './roles'

describe('roles', () => {
  it.each([
    [['OWNER'], ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']],
    [['ADMIN'], ['ADMIN', 'MEMBER', 'VIEWER']],
    [['MEMBER'], ['MEMBER', 'VIEWER']],
    [['VIEWER'], ['VIEWER']],
    [[], []],
  ])('someone holding %j can grant %j', (held, granted) => {
    expect(grantableRoles(held).map((role) => role.name)).toEqual(granted)
  })

  it('ranks by the server’s order, not by the order roles are listed', () => {
    expect(highestRole(['VIEWER', 'ADMIN', 'SUPER_ADMIN'])?.name).toBe('ADMIN')
    expect(highestRole(['SUPER_ADMIN'])).toBeUndefined()
  })

  it('labels known roles and passes unknown ones through', () => {
    expect(roleLabel('MEMBER')).toBe('Member')
    expect(roleLabel('SUPER_ADMIN')).toBe('SUPER_ADMIN')
  })
})
