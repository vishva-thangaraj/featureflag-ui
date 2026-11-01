import { useTenant, type Tenant } from './context'

/** `write`: change flags, environments, keys and members. `manageOrganization`: rename or delete it. */
export type Action = 'write' | 'manageOrganization'

/**
 * Whether to offer an action. The server still decides: a role changed since this page loaded still
 * gets its 403, and the refetch that follows corrects what is offered.
 */
export function can(tenant: Tenant, action: Action): boolean {
  const roles = tenant.roles.map((role) => role.name)
  switch (action) {
    case 'write':
      return roles.includes('OWNER') || roles.includes('ADMIN')
    case 'manageOrganization':
      return roles.includes('OWNER')
  }
}

export function useCan(action: Action): boolean {
  return can(useTenant(), action)
}
