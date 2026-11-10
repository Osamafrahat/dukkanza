import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

// The settlement hint is the whole point of the advance feature on this
// page: before you commit an outbound supplier payment you must SEE how
// much of it an existing advance will cover. It is pure preview maths
// (owed / advance applied / cash to pay) driven by the supplier list, and
// the create response reports back what the server actually consumed.
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
    data: [{ id: 9, name: 'Acme', balance: 1000, advance_available: 300 }],
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

async function fillSupplierSettlement(amount) {
  render(<PaymentsPage />)
  fireEvent.click(await screen.findByRole('button', { name: /New Payment/ }))

  openSelect('Inbound (Received)')
  pickOption('Outbound (Paid)')
  openSelect('Select supplier...')
  pickOption('Acme')

  fireEvent.change(await screen.findByPlaceholderText(/EGP/), { target: { value: amount } })
}

// The hint renders one row per figure: owed, advance applied, cash to pay.
// Assert per row so a number landing in the WRONG row cannot pass.
async function hintRows() {
  const hint = await screen.findByTestId('settlement-hint')
  return Array.from(hint.querySelectorAll(':scope > div'))
}

describe('PaymentsPage — settlement hint', () => {
  it('shows owed, advance applied and cash to pay before saving', async () => {
    await fillSupplierSettlement('500')

    const [owed, applied, cash] = await hintRows()
    expect(owed.textContent).toContain('1,000.00 EGP')
    expect(applied.textContent).toContain('300.00 EGP')
    expect(cash.textContent).toContain('200.00 EGP')

    // And the promise that this is a preview, not a done deal.
    expect(screen.getByText('The advance will be consumed oldest-first when this payment is saved')).toBeTruthy()
  })

  it('caps the advance at what is available when the payment is smaller', async () => {
    await fillSupplierSettlement('100')

    const [, applied, cash] = await hintRows()
    // A 100 payment can only draw 100 of the 300 available; the rest of the
    // advance stays untouched for a later settlement, and no cash is due.
    expect(applied.textContent).toContain('100.00 EGP')
    expect(cash.textContent).toContain('0.00 EGP')
  })

  it('reports the consumed advance in the success toast', async () => {
    paymentsApi.create.mockResolvedValue({ data: { id: 7, advance_applied: 300 } })
    await fillSupplierSettlement('500')

    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() =>
      expect(paymentsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_type: 'outbound', partner_type: 'supplier', partner_id: '9' })
      )
    )
    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((t) => t.message.includes('Advance applied: 300.00'))).toBe(true)
    })
    // The supplier list reloads so the next hint starts from the new balance.
    await waitFor(() => expect(suppliersApi.getAll).toHaveBeenCalledTimes(2))
  })

  it('shows a plain toast when nothing was applied', async () => {
    paymentsApi.create.mockResolvedValue({ data: { id: 8, advance_applied: 0 } })
    await fillSupplierSettlement('500')

    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      const success = toasts.filter((t) => t.type === 'success')
      expect(success).toHaveLength(1)
      expect(success[0].message).toBe('Payment recorded')
    })
  })

  it('renders no hint for inbound payments', async () => {
    render(<PaymentsPage />)

    // Type stays inbound — the supplier picker (and the hint) never appear.
    await screen.findByText('All Types')
    expect(screen.queryByTestId('settlement-hint')).toBeNull()
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
