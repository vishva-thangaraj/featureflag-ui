import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from '@/api/errors'

export const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again."

/**
 * Puts each of a 400's field errors on its input. One with a null field, or a field this form does not
 * have, belongs to the whole form. Returns false when the error carried none, so the caller can say
 * something itself.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  const fieldErrors = error instanceof ApiError ? error.body?.fieldErrors : undefined
  if (!fieldErrors?.length) {
    return false
  }
  for (const { field, message } of fieldErrors) {
    const known = fields.find((name) => name === field)
    if (known) {
      setError(known, { message })
    } else {
      setError('root.server', { message })
    }
  }
  return true
}

/** The message for an error with nothing more specific to say. */
export function fallbackMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : NETWORK_ERROR
}
