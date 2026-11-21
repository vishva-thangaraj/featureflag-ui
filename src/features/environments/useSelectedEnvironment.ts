import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { useTenantId } from '@/tenant/context'
import { useEnvironments } from './queries'

const storageKey = (tenantId: string) => `ff:last-env:${tenantId}`

// A convenience only: storage can be blocked or cleared, and the page works without it.
function readRemembered(tenantId: string): string | null {
  try {
    return localStorage.getItem(storageKey(tenantId))
  } catch {
    return null
  }
}

function remember(tenantId: string, envName: string): void {
  try {
    localStorage.setItem(storageKey(tenantId), envName)
  } catch {
    // Nothing to do: the next visit falls back to the first environment.
  }
}

/**
 * The environment a flag page is looking through: `?env=` when it names one, else the one last used in
 * this organization, else the first. Kept in the URL so a view can be shared.
 */
export function useSelectedEnvironment() {
  const tenantId = useTenantId()
  const environments = useEnvironments()
  const [params, setParams] = useSearchParams()
  const list = environments.data ?? []
  const requested = params.get('env')
  const remembered = readRemembered(tenantId)
  const selected =
    list.find((env) => env.name === requested) ?? list.find((env) => env.name === remembered) ?? list[0]

  useEffect(() => {
    if (selected) {
      remember(tenantId, selected.name)
    }
  }, [tenantId, selected])

  function select(envName: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('env', envName)
        return next
      },
      { replace: true },
    )
  }

  return { environments, selected, select }
}
