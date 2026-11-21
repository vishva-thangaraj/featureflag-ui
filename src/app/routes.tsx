import { Navigate, type RouteObject } from 'react-router'
import { LoginPage } from '@/auth/LoginPage'
import { RegisterPage } from '@/auth/RegisterPage'
import { RequireSession } from '@/auth/RequireSession'
import { RequireSignedOut } from '@/auth/RequireSignedOut'
import { ApiKeysPage } from '@/features/api-keys/ApiKeysPage'
import { EnvironmentsPage } from '@/features/environments/EnvironmentsPage'
import { FlagDetailPage } from '@/features/flags/FlagDetailPage'
import { FlagsPage } from '@/features/flags/FlagsPage'
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
          { path: 'flags', element: <FlagsPage /> },
          { path: 'flags/:featureId', element: <FlagDetailPage /> },
          { path: 'environments', element: <EnvironmentsPage /> },
          { path: 'api-keys', element: <ApiKeysPage /> },
          { path: 'members', element: <ScreenPlaceholder title="Members" /> },
          { path: 'settings', element: <ScreenPlaceholder title="Settings" /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
