import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

// SuppliersPage now carries a per-supplier ADVANCE balance next to the AP
// balance, plus the modal that records one. Both are gated on suppliers_edit,
// so the mock has to serve the enriched supplier list (balance +
// advance_available come from GET /suppliers) and capture the create call.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    authApi: { me: ok(null) },
    usersApi: { getAll: ok([]) },
    suppliersApi: { getAll: ok([]), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    supplierAdvancesApi: { list: ok({ data: [], available: 0 }), create: vi.fn(), available: ok({ available: 0 }) },
  }
})

import SuppliersPage from '../pages/SuppliersPage'
import { suppliersApi, supplierAdvancesApi } from '../lib/api'
import { useUserStore } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  // MANAGER passes hasPermission for everything — the canEdit path.
  useUserStore.setState({ currentUser: { id: 1, role: 'MANAGER', permissions: [] } })
  suppliersApi.getAll.mockResolvedValue({
    data: [
      { id: 1, name: 'Acme', account_code: '20101', balance: 500, advance_available: 300 },
      { id: 2, name: 'Beta', account_code: null, balance: 0, advance_available: 0 },
    ],
  })
})

describe('SuppliersPage — advance balance', () => {
  it('shows the advance balance beside the AP balance', async () => {
    render(<SuppliersPage />)

    // One chip per supplier card.
    expect(await screen.findAllByText('Advance Balance:')).toHaveLength(2)
    // 300.00 is Acme's remaining advance; the AP figure renders too.
    expect(screen.getByText('300.00')).toBeTruthy()
    expect(screen.getByText('500.00')).toBeTruthy()
    // One record button per supplier card.
    expect(screen.getAllByRole('button', { name: /Record Advance/ })).toHaveLength(2)
  })

  it('records an advance against the supplier of the card you clicked', async () => {
    supplierAdvancesApi.create.mockResolvedValue({ data: { id: 9, amount: 150 } })
    render(<SuppliersPage />)

    // First card = Acme (the list is sorted by name server-side; here the
    // fixture order is Acme first).
    const cardButtons = await screen.findAllByRole('button', { name: /Record Advance/ })
    fireEvent.click(cardButtons[0])

    // Modal is open: it carries the supplier's name so you know who you pay.
    expect(screen.getByText('Pay an advance to')).toBeTruthy()
    // Once in the card header, once in the modal.
    expect(screen.getAllByText('Acme')).toHaveLength(2)

    fireEvent.change(screen.getByPlaceholderText(/EGP/), { target: { value: '150' } })

    // Two buttons share the label (card + modal submit); the modal renders
    // after the grid, so the submit is the last one.
    const buttons = screen.getAllByRole('button', { name: /Record Advance/ })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() =>
      expect(supplierAdvancesApi.create).toHaveBeenCalledWith({
        supplier_id: 1,
        amount: 150,
        method: 'cash',
        notes: null,
      })
    )

    // Success toast comes from the store (no Toaster is mounted here).
    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((t) => t.message === 'Advance recorded successfully')).toBe(true)
    })
    // The list refetches so the chip reflects the new balance.
    await waitFor(() => expect(suppliersApi.getAll).toHaveBeenCalledTimes(2))
  })

  it('surfaces a server-side failure instead of claiming success', async () => {
    supplierAdvancesApi.create.mockRejectedValue({
      response: { data: { error: 'Deposit cannot exceed the order total' } },
    })
    render(<SuppliersPage />)

    fireEvent.click((await screen.findAllByRole('button', { name: /Record Advance/ }))[0])
    fireEvent.change(screen.getByPlaceholderText(/EGP/), { target: { value: '10' } })
    const buttons = screen.getAllByRole('button', { name: /Record Advance/ })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((t) => t.type === 'error')).toBe(true)
    })
    // Modal stays open so the value is not lost.
    expect(screen.getByText('Pay an advance to')).toBeTruthy()
  })

  it('hides the record-advance action without suppliers_edit', async () => {
    // No user at all -> hasPermission returns false everywhere.
    useUserStore.setState({ currentUser: null })
    render(<SuppliersPage />)

    expect(await screen.findAllByText('Advance Balance:')).toHaveLength(2)
    // The balance is still VISIBLE (it is information, not an action).
    expect(screen.getByText('300.00')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /Record Advance/ })).toHaveLength(0)
  })
})
