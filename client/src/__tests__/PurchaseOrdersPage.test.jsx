import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// PurchaseOrdersPage accepts the quick-action handoff from Suppliers:
//   /purchase-orders?new=1&supplier=<id>
// which must open the create form with that supplier already selected
// (option values are String(s.id), hence the String() on the param).
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    purchaseOrdersApi: {
      getAll: ok([]),
      getStats: ok({}),
      create: vi.fn(),
      getById: ok({ data: {} }),
      update: vi.fn(),
      receive: vi.fn(),
      delete: vi.fn(),
    },
    suppliersApi: { getAll: ok({ data: [] }) },
    productsApi: { getAll: ok({ data: [] }) },
    emailApi: { sendPO: vi.fn() },
    // ok(X) already wraps in { data: X } — branchStore reads res.data.data.
    branchesApi: { getAll: ok({ data: [] }) },
  }
})

// branchStore clears the offline product cache when branches reload.
vi.mock('../lib/offlineDB', () => ({ clearCachedProducts: vi.fn() }))

import PurchaseOrdersPage from '../pages/PurchaseOrdersPage'
import { suppliersApi } from '../lib/api'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  suppliersApi.getAll.mockResolvedValue({ data: { data: [{ id: 1, name: 'Acme' }] } })
})

const renderPage = (initialEntries = ['/purchase-orders']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <PurchaseOrdersPage />
    </MemoryRouter>
  )

describe('PurchaseOrdersPage — quick-action handoff', () => {
  it('opens the create form with the handed-off supplier selected', async () => {
    renderPage(['/purchase-orders?new=1&supplier=1'])

    // No Create PO click — the param opened the form. The supplier
    // combobox resolves value '1' against the loaded options and shows
    // the supplier's name.
    const supplierTrigger = await waitFor(() => {
      const el = screen
        .getAllByRole('combobox')
        .find((x) => x.textContent.includes('Acme'))
      expect(el).toBeTruthy()
      return el
    })
    expect(supplierTrigger).toBeTruthy()
  })

  it('stays closed without the handoff params', async () => {
    renderPage()

    // Page loads, but the create form (and its supplier select) never opens.
    await screen.findByRole('button', { name: /Create PO/ })
    const supplierTrigger = screen
      .queryAllByRole('combobox')
      .find((el) => el.textContent.includes('Acme'))
    expect(supplierTrigger).toBeUndefined()
  })
})
