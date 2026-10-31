import { describe, expect, it } from 'vitest'
import { safeNextPath } from './next'

describe('safeNextPath', () => {
  it.each([
    ['/t/1/flags?env=production', '/t/1/flags?env=production'],
    [null, '/orgs'],
    ['', '/orgs'],
    ['flags', '/orgs'],
    ['https://evil.example/', '/orgs'],
    ['//evil.example/', '/orgs'],
    ['/\\evil.example/', '/orgs'],
  ])('%j → %s', (next, expected) => {
    expect(safeNextPath(next)).toBe(expected)
  })
})
