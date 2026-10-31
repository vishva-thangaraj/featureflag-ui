/** Stands in for a screen that is routed but not built yet. */
export function ScreenPlaceholder({ title }: { title: string }) {
  return (
    <section aria-labelledby="screen-title" className="flex flex-col gap-1">
      <h1 id="screen-title" className="text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      <p className="text-muted-foreground">Not built yet.</p>
    </section>
  )
}
