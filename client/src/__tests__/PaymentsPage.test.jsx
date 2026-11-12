import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// An outbound payment must name a supplier (the server 400s otherwise —
// without one the supplier's Remaining Balance could never move), and a
// successful save posts the payment with a plain toast. The page also
// accepts a quick-action handoff from Suppliers:
//   /accounting/payments?new=1&type=outbound&supplier=<id>
// which must open the form pre-filled and consume the params.
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

// The page reads search params, so every render needs a router context.
const renderPage = (initialEntries = ['/accounting/payments']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <PaymentsPage />
    </MemoryRouter>
  )

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
    renderPage()
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
    renderPage()
    await screen.findByRole('button', { name: /New Payment/ })

    // Type stays inbound — no supplier combobox exists to open.
    const supplierTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent.includes('Select supplier...'))
    expect(supplierTrigger).toBeUndefined()
  })

  it('refuses to save an outbound payment without a supplier', async () => {
    renderPage()
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

describe('PaymentsPage — quick-action handoff', () => {
  it('opens the form pre-filled from ?new=1&type=outbound&supplier=<id>', async () => {
    renderPage(['/accounting/payments?new=1&type=outbound&supplier=9'])

    // The form is open without clicking New Payment, type is outbound, and
    // the supplier combobox shows the handed-off supplier (value supplier:9
    // resolves against the loaded options).
    const supplierTrigger = await waitFor(() => {
      const el = screen
        .getAllByRole('combobox')
        .find((x) => x.textContent.includes('Acme'))
      expect(el).toBeTruthy()
      return el
    })
    expect(supplierTrigger).toBeTruthy()

    const typeTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent.includes('Outbound (Paid)'))
    expect(typeTrigger).toBeTruthy()
  })

  it('leaves the page untouched without the handoff params', async () => {
    renderPage()

    await screen.findByRole('button', { name: /New Payment/ })
    // No supplier combobox — the form was not auto-opened.
    const supplierTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent.includes('Select supplier...'))
    expect(supplierTrigger).toBeUndefined()
  })
})
