import { Navigate, type RouteObject } from 'react-router'
import { RequireSession } from '@/auth/RequireSession'
import { ScreenPlaceholder } from '@/pages/ScreenPlaceholder'
import { OrgPicker } from '@/tenant/OrgPicker'
import { TenantLayout } from '@/tenant/TenantLayout'

export const routes: RouteObject[] = [
  { path: '/login', element: <ScreenPlaceholder title="Sign in" /> },
  { path: '/register', element: <ScreenPlaceholder title="Create an account" /> },
  { path: '/invitations/accept', element: <ScreenPlaceholder title="Accept invitation" /> },
  {
    element: <RequireSession />,
    children: [
      { path: '/orgs', element: <OrgPicker /> },
      { path: '/orgs/new', element: <ScreenPlaceholder title="Create an organization" /> },
      {
        path: '/t/:tenantId',
        element: <TenantLayout />,
        children: [
          { index: true, element: <Navigate to="flags" replace /> },
          { path: 'flags', element: <ScreenPlaceholder title="Flags" /> },
          { path: 'flags/:featureId', element: <ScreenPlaceholder title="Flag" /> },
          { path: 'environments', element: <ScreenPlaceholder title="Environments" /> },
          { path: 'api-keys', element: <ScreenPlaceholder title="API keys" /> },
          { path: 'members', element: <ScreenPlaceholder title="Members" /> },
          { path: 'settings', element: <ScreenPlaceholder title="Settings" /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/orgs" replace /> },
]
