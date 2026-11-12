import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

// An outbound payment must name a supplier (the server 400s otherwise —
// without one the supplier's Remaining Balance could never move), and a
// successful save posts the payment with a plain toast. The pre-save
// preview panel left with the advance feature.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    paymentsApi: { getAll: ok({ data: [] }), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    suppliersApi: { getAll: ok([]) },
  }
})

import PaymentsPage from '../pages/PaymentsPage'
import { paymentsApi, suppliersApi } from '../lib/api'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  // GET /accounting/payments resolves to { data: { data: [...] } } — the
  // page reads data.data.
  paymentsApi.getAll.mockResolvedValue({ data: { data: [] } })
  suppliersApi.getAll.mockResolvedValue({
    data: [{ id: 9, name: 'Acme', balance: 1000 }],
  })
})

// SearchableSelect renders a role="combobox" trigger whose text is the
// currently-selected label; opening it reveals option buttons.
function openSelect(triggerText) {
  const trigger = screen.getAllByRole('combobox').find((el) => el.textContent.includes(triggerText))
  expect(trigger).toBeTruthy()
  fireEvent.click(trigger)
}

function pickOption(label) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('PaymentsPage — outbound payments', () => {
  it('saves an outbound payment against the selected supplier', async () => {
    paymentsApi.create.mockResolvedValue({ data: { id: 7 } })
    render(<PaymentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /New Payment/ }))

    openSelect('Inbound (Received)')
    pickOption('Outbound (Paid)')
    openSelect('Select supplier...')
    pickOption('Acme')
    fireEvent.change(await screen.findByPlaceholderText(/EGP/), { target: { value: '500' } })

    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() =>
      expect(paymentsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_type: 'outbound', partner_type: 'supplier', partner_id: '9' })
      )
    )
    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((t) => t.message === 'Payment recorded')).toBe(true)
    })
  })

  it('offers no supplier picker for inbound payments', async () => {
    render(<PaymentsPage />)
    await screen.findByRole('button', { name: /New Payment/ })

    // Type stays inbound — no supplier combobox exists to open.
    const supplierTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent.includes('Select supplier...'))
    expect(supplierTrigger).toBeUndefined()
  })

  it('refuses to save an outbound payment without a supplier', async () => {
    render(<PaymentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /New Payment/ }))

    openSelect('Inbound (Received)')
    pickOption('Outbound (Paid)')
    // Supplier deliberately left unselected, then an amount is typed.
    fireEvent.change(await screen.findByPlaceholderText(/EGP/), { target: { value: '100' } })

    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((t) => t.type === 'error' && t.message === 'Select a supplier for this payment')).toBe(true)
    })
    // The request never leaves the client — nothing to roll back server-side.
    expect(paymentsApi.create).not.toHaveBeenCalled()
  })
})
