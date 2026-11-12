import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// SuppliersPage is now a small dashboard: header summary cards (fed by
// GET /suppliers/overview), search + sort over the list, data-quality
// badges, quick actions (Call/WhatsApp/Pay/New PO/Details), and a detail
// drawer fed by the enriched GET /suppliers/:id. These tests pin:
//   - the AP balance path surviving from before (no advance UI),
//   - the summary/search/sort/badge behavior,
//   - the drawer's balance + aging + stats,
//   - the quick-action handoffs (navigate with the supplier id).
const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    authApi: { me: ok(null) },
    usersApi: { getAll: ok([]) },
    suppliersApi: {
      getAll: ok([]),
      overview: ok({ purchases_30d: 1234 }),
      getById: ok({}),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      importCsv: ok([]),
    },
  }
})

import SuppliersPage from '../pages/SuppliersPage'
import { suppliersApi } from '../lib/api'
import { useUserStore } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  // MANAGER passes hasPermission for everything — the canEdit path.
  useUserStore.setState({ currentUser: { id: 1, role: 'MANAGER', permissions: [] } })
  // Acme: complete record + AP account. Beta: bigger balance but no AP
  // account and missing phone/email (the badge case).
  suppliersApi.getAll.mockResolvedValue({
    data: [
      {
        id: 1,
        name: 'Acme',
        account_code: '20101',
        balance: 500,
        phone: '+201011111111',
        email: 'buyer@acme.example',
      },
      { id: 2, name: 'Beta', account_code: null, balance: 1000 },
    ],
  })
  suppliersApi.overview.mockResolvedValue({ data: { purchases_30d: 1234 } })
  suppliersApi.getById.mockResolvedValue({
    data: {
      id: 1,
      name: 'Acme',
      account_code: '20101',
      balance: 90,
      aging: { current: 50, d30: 40, d60: 0, total: 90 },
      stats: {
        po_count: 2,
        total_purchased: 150,
        last_po_date: '2026-10-01',
        payment_count: 1,
        total_paid: 70,
      },
      products: [{ id: 7, name: 'Gadget', sku: 'G-1', price: 10, stock_quantity: 3 }],
      recent_pos: [],
      recent_payments: [],
    },
  })
})

const renderPage = () => render(<MemoryRouter><SuppliersPage /></MemoryRouter>)

const fmt = (n) =>
  n.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

describe('SuppliersPage — AP balance (pre-existing behavior)', () => {
  it('shows Remaining Balance only for suppliers that have an AP account', async () => {
    renderPage()

    // Acme carries account_code so its chip renders; Beta has none.
    expect(await screen.findAllByText('Remaining Balance:')).toHaveLength(1)
    expect(screen.getByText('500.00')).toBeTruthy()
  })

  it('renders no advance UI anywhere', async () => {
    renderPage()

    await screen.findAllByText('Remaining Balance:')
    // The whole advance feature is gone: no row, no record button.
    expect(screen.queryByText('Advance Balance:')).toBeNull()
    expect(screen.queryAllByRole('button', { name: /Record Advance/ })).toHaveLength(0)
  })
})

describe('SuppliersPage — summary cards', () => {
  it('totals owed, supplier count, and 30-day purchases', async () => {
    renderPage()

    expect(await screen.findByText('Total Owed')).toBeTruthy()
    // 500 (Acme) + 1000 (Beta)
    expect(screen.getByText(`${fmt(1500)} EGP`)).toBeTruthy()
    // Two suppliers on the page — the h1 and the summary card.
    expect(screen.getAllByText('Suppliers')).toHaveLength(2)
    expect(screen.getByText('2')).toBeTruthy()
    // Overview card comes from GET /suppliers/overview.
    expect(screen.getByText(`${fmt(1234)} EGP`)).toBeTruthy()
    expect(suppliersApi.overview).toHaveBeenCalledTimes(1)
  })

  it('renders the page even when the overview call fails', async () => {
    suppliersApi.overview.mockRejectedValue(new Error('boom'))
    renderPage()

    // Grid still shows, overview card falls back to an em dash.
    expect(await screen.findByText('Acme')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })
})

describe('SuppliersPage — search and sort', () => {
  it('filters the list by search text', async () => {
    renderPage()
    await screen.findByText('Acme')

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'Beta' } })

    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.queryByText('Acme')).toBeNull()
  })

  it('shows the no-match state when nothing fits the search', async () => {
    renderPage()
    await screen.findByText('Acme')

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'zzz' } })

    expect(screen.getByText('No suppliers match your search')).toBeTruthy()
    expect(screen.queryByText('Acme')).toBeNull()
  })

  it('sorts by balance descending on request', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()

    // Default A-Z: Acme first. Flip to balance desc: Beta (1000) first.
    const sortTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent.includes('Name (A-Z)'))
    expect(sortTrigger).toBeTruthy()
    fireEvent.click(sortTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Balance (highest first)' }))

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings.indexOf('Beta')).toBeLessThan(headings.indexOf('Acme'))
  })
})

describe('SuppliersPage — data-quality badges', () => {
  it('flags suppliers missing phone or email', async () => {
    renderPage()
    await screen.findByText('Acme')

    // Beta has neither; Acme has both.
    expect(screen.getByText('No phone')).toBeTruthy()
    expect(screen.getByText('No email')).toBeTruthy()
  })
})

describe('SuppliersPage — quick actions', () => {
  it('offers Call/WhatsApp links only when a phone exists', async () => {
    renderPage()
    await screen.findByText('Acme')

    const waLinks = screen.getAllByRole('link', { name: /WhatsApp/ })
    // Only Acme has a phone; digits-only per wa.me rules.
    expect(waLinks).toHaveLength(1)
    expect(waLinks[0].getAttribute('href')).toBe('https://wa.me/201011111111')
    const telLinks = screen.getAllByRole('link', { name: /Call/ })
    expect(telLinks).toHaveLength(1)
    expect(telLinks[0].getAttribute('href')).toBe('tel:+201011111111')
  })

  it('hands off to Payments with the supplier id', async () => {
    renderPage()
    await screen.findByText('Acme')

    fireEvent.click(screen.getAllByRole('button', { name: /Pay/ })[0])

    expect(navigateMock).toHaveBeenCalledWith('/accounting/payments?new=1&type=outbound&supplier=1')
  })

  it('hands off to Purchase Orders with the supplier id', async () => {
    renderPage()
    await screen.findByText('Acme')

    fireEvent.click(screen.getAllByRole('button', { name: /New PO/ })[0])

    expect(navigateMock).toHaveBeenCalledWith('/purchase-orders?new=1&supplier=1')
  })
})

describe('SuppliersPage — detail drawer', () => {
  it('opens the drawer with balance, aging buckets and lifetime stats', async () => {
    renderPage()
    await screen.findByText('Acme')

    fireEvent.click(screen.getAllByRole('button', { name: /Details/ })[0])

    expect(suppliersApi.getById).toHaveBeenCalledWith(1)
    // Balance + the three aging buckets from the FIFO journal walk.
    expect(await screen.findByText('Current')).toBeTruthy()
    expect(screen.getByText('31-60 days')).toBeTruthy()
    expect(screen.getByText('60+ days')).toBeTruthy()
    expect(screen.getByText('90.00')).toBeTruthy()
    // Lifetime stats row.
    expect(screen.getByText('Total Purchased')).toBeTruthy()
    expect(screen.getByText('Last Order')).toBeTruthy()
    expect(screen.getByText('Total Paid')).toBeTruthy()
    // Products tab is the default and shows the mocked product.
    expect(await screen.findByText('Gadget')).toBeTruthy()
  })

  it('switches to the orders tab with its empty state', async () => {
    renderPage()
    await screen.findByText('Acme')
    fireEvent.click(screen.getAllByRole('button', { name: /Details/ })[0])
    await screen.findByText('Gadget')

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))

    expect(await screen.findByText('No purchase orders yet')).toBeTruthy()
  })

  it('toasts and closes when the detail fetch fails', async () => {
    suppliersApi.getById.mockRejectedValue(new Error('boom'))
    renderPage()
    await screen.findByText('Acme')

    fireEvent.click(screen.getAllByRole('button', { name: /Details/ })[0])

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((x) => x.type === 'error')).toBe(true)
    })
    // Drawer is gone — no spinner left behind.
    expect(screen.queryByText('Total Purchased')).toBeNull()
  })
})
