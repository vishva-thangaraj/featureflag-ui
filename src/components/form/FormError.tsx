/** An error that belongs to the whole form, above its fields. Announced as soon as it appears. */
export function FormError({ message }: { message: string | undefined }) {
  if (!message) {
    return null
  }
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}
