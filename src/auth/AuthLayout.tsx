import type { ReactNode } from 'react'
import { Flag } from 'lucide-react'

interface AuthLayoutProps {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}

/** The centred card the signed-out pages share. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-md bg-foreground text-background">
          <Flag className="size-3.5" />
        </span>
        Platform
      </div>
      <section aria-labelledby="auth-title" className="w-full max-w-sm rounded-xl border bg-card p-6">
        <h1 id="auth-title" className="text-xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
        <div className="mt-5">{children}</div>
      </section>
      {footer && <div className="text-sm text-muted-foreground">{footer}</div>}
    </main>
  )
}
