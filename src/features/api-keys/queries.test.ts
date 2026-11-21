// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formatDate } from '@/lib/format'
import { rotatedName } from './queries'

describe('rotatedName', () => {
  const now = Date.parse('2026-11-21T09:00:00Z')
  const today = formatDate(new Date(now).toISOString())

  it('marks the replacement with the date', () => {
    expect(rotatedName('web-prod', now)).toBe(`web-prod (rotated ${today})`)
  })

  it('replaces an earlier rotation suffix instead of adding another', () => {
    expect(rotatedName('web-prod (rotated 3 Sept 2026)', now)).toBe(`web-prod (rotated ${today})`)
    expect(rotatedName('web-prod (rotated 3 Sept 2026) (rotated 9 Oct 2026)', now)).toBe(`web-prod (rotated ${today})`)
  })
})
