import { Navigate, type RouteObject } from 'react-router'
import { LoginPage } from '@/auth/LoginPage'
import { RegisterPage } from '@/auth/RegisterPage'
import { RequireSession } from '@/auth/RequireSession'
import { RequireSignedOut } from '@/auth/RequireSignedOut'
import { ScreenPlaceholder } from '@/pages/ScreenPlaceholder'
import { CreateOrgPage } from '@/tenant/CreateOrgPage'
import { OrgEntry, OrgPicker } from '@/tenant/OrgPicker'
import { TenantLayout } from '@/tenant/TenantLayout'

export const routes: RouteObject[] = [
  {
    element: <RequireSignedOut />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  { path: '/invitations/accept', element: <ScreenPlaceholder title="Accept invitation" /> },
  {
    element: <RequireSession />,
    children: [
      { path: '/', element: <OrgEntry /> },
      { path: '/orgs', element: <OrgPicker /> },
      { path: '/orgs/new', element: <CreateOrgPage /> },
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
  { path: '*', element: <Navigate to="/" replace /> },
]
