/**
 * Where to send someone after they sign in. Only a path on this site: `//host` and `/\host` are other
 * sites to a browser, and following them would turn a crafted sign-in link into a redirect anywhere.
 */
export function safeNextPath(next: string | null, fallback = '/orgs'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback
  }
  return next
}
