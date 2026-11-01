import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { Flag, KeyRound, Layers, SlidersHorizontal, Users } from 'lucide-react'
import { signOut } from '@/auth/signOut'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTenant } from '@/tenant/context'

const NAV = [
  { to: 'flags', label: 'Flags', icon: Flag },
  { to: 'environments', label: 'Environments', icon: Layers },
  { to: 'api-keys', label: 'API keys', icon: KeyRound },
  { to: 'members', label: 'Members', icon: Users },
  { to: 'settings', label: 'Settings', icon: SlidersHorizontal },
]

export function AppShell({ children }: { children: ReactNode }) {
  const tenant = useTenant()

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <nav
        aria-label="Primary"
        className="flex flex-col gap-2 border-b bg-sidebar p-3 text-sidebar-foreground md:w-60 md:shrink-0 md:border-r md:border-b-0"
      >
        <Link
          to="/orgs"
          aria-label={`Switch organization: ${tenant.name}`}
          className="flex h-11 items-center gap-2.5 rounded-lg border bg-card px-2.5 text-foreground"
        >
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-md bg-primary-soft text-xs font-semibold text-primary"
          >
            {tenant.name.charAt(0).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{tenant.name}</span>
            <span className="text-[11px] tracking-wide text-muted-foreground">{tenant.plan} PLAN</span>
          </span>
        </Link>

        <ul className="mt-2 flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-2.5 rounded-md px-2.5 font-medium',
                    isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-accent',
                  )
                }
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-2">
          <Button variant="ghost" className="w-full justify-start" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </nav>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-7">{children}</main>
    </div>
  )
}
