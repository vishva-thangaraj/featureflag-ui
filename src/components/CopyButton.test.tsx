// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { CopyButton } from './CopyButton'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CopyButton', () => {
  it('names the action in its label and in a tooltip with the same text', async () => {
    render(<CopyButton value="checkout_v2" label="Flag key" />)
    const button = screen.getByRole('button', { name: 'Copy flag key' })

    fireEvent.pointerMove(button, { pointerType: 'mouse' })

    expect((await screen.findByRole('tooltip')).textContent).toBe('Copy flag key')
  })

  it('keeps an acronym in capitals', () => {
    render(<CopyButton value="{}" label="SDK configuration" />)

    expect(screen.getByRole('button', { name: 'Copy SDK configuration' })).toBeDefined()
  })

  it('copies the value and says so', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<CopyButton value="904363551855243733" label="Organization id" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy organization id' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Organization id copied'))
    expect(writeText).toHaveBeenCalledWith('904363551855243733')
  })
})
