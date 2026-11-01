// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCountdown } from './useCountdown'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('counts whole seconds down to zero, then stops', () => {
  const { result } = renderHook(() => useCountdown())

  act(() => result.current[1](2))
  expect(result.current[0]).toBe(2)

  act(() => vi.advanceTimersByTime(1000))
  expect(result.current[0]).toBe(1)

  act(() => vi.advanceTimersByTime(1000))
  expect(result.current[0]).toBe(0)

  act(() => vi.advanceTimersByTime(5000))
  expect(result.current[0]).toBe(0)
})
