import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  /** The page's one primary action, top right. */
  actions?: ReactNode
  /** For roles that can only look: one quiet line, instead of a page of disabled buttons. */
  viewOnly?: boolean
}

export function PageHeader({ title, description, actions, viewOnly }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
        {viewOnly && <p className="text-sm text-muted-foreground">View only. Ask an admin to make changes.</p>}
      </div>
      {actions}
    </header>
  )
}
