import { describe, expect, it } from 'vitest'
import { safeNextPath } from './next'

describe('safeNextPath', () => {
  it.each([
    ['/t/1/flags?env=production', '/t/1/flags?env=production'],
    [null, '/'],
    ['', '/'],
    ['flags', '/'],
    ['https://evil.example/', '/'],
    ['//evil.example/', '/'],
    ['/\\evil.example/', '/'],
  ])('%j → %s', (next, expected) => {
    expect(safeNextPath(next)).toBe(expected)
  })
})
