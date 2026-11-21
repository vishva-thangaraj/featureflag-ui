/** The backend's rule: the key is a path segment on /config/{featureKey}, so no `/`. */
export const FLAG_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,49}$/

/**
 * A valid key close to what was typed -- "Checkout V2" becomes "checkout_v2" -- offered as a one-click
 * fix rather than applied silently. Null when nothing sensible exists, or when the input is already fine.
 */
export function suggestFlagKey(input: string): string | null {
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
  if (!FLAG_KEY_PATTERN.test(key) || key === input) {
    return null
  }
  return key
}
