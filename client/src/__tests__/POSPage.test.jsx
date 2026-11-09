import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// POSPage touches nine API surfaces plus the IndexedDB cache on mount.
// Stub them all so no axios call escapes and jsdom (which has no
// indexedDB) never sees real cache work. The factory is hoisted above
// the imports, so the helper lives inside it.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    productsApi: { getAll: ok([]), getByBarcode: vi.fn() },
    categoriesApi: { getAll: ok([]) },
    customersApi: { getAll: ok([]) },
    servicesApi: { getAll: ok([]) },
    servicePlansApi: { getAll: ok([]) },
    subscriptionsApi: { quickCreate: vi.fn() },
    cashShiftsApi: {
      getActive: ok(null),
      getActiveStats: ok(null),
      open: vi.fn(),
      close: vi.fn(),
    },
    ordersApi: { create: vi.fn(), getById: vi.fn() },
    creditSalesApi: { create: vi.fn() },
  }
})

vi.mock('../lib/offlineDB', () => ({
  getSyncMeta: vi.fn().mockResolvedValue(null),
  setSyncMeta: vi.fn().mockResolvedValue(undefined),
}))

import POSPage from '../pages/POSPage'
import { productsApi, cashShiftsApi } from '../lib/api'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <POSPage />
    </MemoryRouter>
  )

describe('POSPage', () => {
  it('renders the POS desk and kicks off its data loads', async () => {
    const utils = renderPage()

    // The product search box is the page's anchor control — it can only
    // render if the whole desk (tabs, grid, cart) mounted without throwing.
    expect(
      utils.getByPlaceholderText('Search products by name, SKU, or scan barcode...')
    ).toBeTruthy()

    // Mount effect: product catalogue + own cash box must both be fetched.
    await waitFor(() => expect(productsApi.getAll).toHaveBeenCalled())
    await waitFor(() => expect(cashShiftsApi.getActive).toHaveBeenCalled())
  })
})
