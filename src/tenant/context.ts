import { createContext, use } from 'react'
import { useParams } from 'react-router'
import type { components } from '@/api/schema'

export type Tenant = components['schemas']['TenantResponse']

export const TenantContext = createContext<Tenant | null>(null)

/** The organization in the URL, once TenantLayout has confirmed the caller belongs to it. */
export function useTenant(): Tenant {
  const tenant = use(TenantContext)
  if (!tenant) {
    throw new Error('useTenant must be used inside TenantLayout')
  }
  return tenant
}

export function useTenantId(): string {
  const { tenantId } = useParams()
  if (!tenantId) {
    throw new Error('useTenantId must be used under /t/:tenantId')
  }
  return tenantId
}

// The tenant comes first in every key, so one organization's cache can never answer for another.
export function tenantKey(tenantId: string, ...rest: (string | undefined)[]) {
  return ['t', tenantId, ...rest] as const
}

export function tenantHeaders(tenantId: string) {
  return { 'X-Tenant-Id': tenantId }
}
