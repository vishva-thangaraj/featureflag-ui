export type RoleName = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'

export interface Role {
  name: RoleName
  label: string
  /** The server's RoleName rank: a caller can grant roles up to their own. */
  rank: number
  description: string
}

// MEMBER and VIEWER have the same permissions today; the copy says so rather than inventing a difference.
export const ROLES: readonly Role[] = [
  { name: 'OWNER', label: 'Owner', rank: 80, description: 'Everything an admin can do, plus rename or delete the organization' },
  { name: 'ADMIN', label: 'Admin', rank: 60, description: 'Change flags, environments, API keys and members' },
  { name: 'MEMBER', label: 'Member', rank: 40, description: 'View everything, change nothing' },
  { name: 'VIEWER', label: 'Viewer', rank: 20, description: 'Same as Member today: view everything, change nothing' },
]

/** The highest of the roles named, ignoring names this dashboard doesn't know. */
export function highestRole(names: readonly string[]): Role | undefined {
  return ROLES.find((role) => names.includes(role.name))
}

export function roleLabel(name: string): string {
  return ROLES.find((role) => role.name === name)?.label ?? name
}

/** What someone holding `callerRoles` may hand out: their own rank and below. */
export function grantableRoles(callerRoles: readonly string[]): Role[] {
  const ceiling = highestRole(callerRoles)?.rank ?? 0
  return ROLES.filter((role) => role.rank <= ceiling)
}

export function canWriteAs(role: RoleName): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}
