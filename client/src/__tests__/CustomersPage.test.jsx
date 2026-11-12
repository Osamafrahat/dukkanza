import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// CustomersPage grew a dashboard shell (summary cards fed by
// GET /customers/overview, sort, data-quality badges, quick actions) and
// its drawer now reads the statement endpoint (orders + payments + credit
// sales in one trip — it existed but nothing called it) plus the
// customer's subscriptions. These tests pin:
//   - the summary cards and their failure tolerance,
//   - sort/badges/quick-action handoffs,
//   - the drawer's statement-backed stats, credit tab and subscriptions
//     tab (the reason ordersApi disappeared from this page).
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
    customersApi: {
      getAll: ok([]),
      overview: ok({}),
      getById: ok({}),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      importCsv: ok([]),
    },
    customerStatementsApi: { getStatement: ok({}) },
    subscriptionsApi: { getAll: ok([]) },
    // No ordersApi on purpose: the drawer must use the statement endpoint.
  }
})

import CustomersPage from '../pages/CustomersPage'
import { customersApi, customerStatementsApi, subscriptionsApi } from '../lib/api'
import { useUserStore } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  // MANAGER passes hasPermission for everything — the canEdit path.
  useUserStore.setState({ currentUser: { id: 1, role: 'MANAGER', permissions: [] } })
  // Acme: complete record, smaller spend. Beta: bigger spend, missing
  // phone/email (the badge case).
  customersApi.getAll.mockResolvedValue({
    data: [
      {
        id: 1,
        name: 'Acme',
        phone: '+201011111111',
        email: 'buyer@acme.example',
        total_spent: 5000,
        loyalty_points: 120,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 2,
        name: 'Beta',
        total_spent: 9000,
        loyalty_points: 10,
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ],
  })
  customersApi.overview.mockResolvedValue({
    data: { sales_30d: 1234, outstanding_credit: 456 },
  })
  customerStatementsApi.getStatement.mockResolvedValue({
    data: {
      summary: { total_orders: 2, total_orders_amount: 150, total_payments: 60, outstanding_balance: 90 },
      orders: [
        {
          id: 30,
          order_number: 'ORD-30',
          date: '2026-10-01T00:00:00.000Z',
          total: 100,
          payment_status: 'paid',
          items: [{ product_name: 'Gadget', quantity: 1, total: 100 }],
        },
        {
          id: 29,
          order_number: 'ORD-29',
          date: '2026-10-10T00:00:00.000Z',
          total: 50,
          payment_status: 'pending',
          items: [],
        },
      ],
      payments: [{ id: 1, order_id: 30, amount: 100, method: 'cash', date: '2026-10-01T00:00:00.000Z' }],
      credit_sales: [
        {
          id: 5,
          order_id: 29,
          total_amount: 50,
          paid_amount: 10,
          remaining_amount: 40,
          status: 'partial',
          due_date: '2026-11-01',
          date: '2026-10-10T00:00:00.000Z',
        },
      ],
    },
  })
  subscriptionsApi.getAll.mockResolvedValue({
    data: [
      {
        id: 7,
        status: 'active',
        start_date: '2026-01-01',
        end_date: '2027-01-01',
        next_billing_date: '2026-12-01',
        billing_amount: 300,
        plan: { name: 'Pro Plan' },
        service: null,
      },
    ],
  })
})

const renderPage = () => render(<MemoryRouter><CustomersPage /></MemoryRouter>)

describe('CustomersPage — summary cards', () => {
  it('shows outstanding credit, customer count and 30-day sales', async () => {
    renderPage()

    expect(await screen.findByText('Outstanding Credit')).toBeTruthy()
    expect(screen.getByText('ج.م 456.00')).toBeTruthy()
    expect(screen.getByText('Sales (30d)')).toBeTruthy()
    expect(screen.getByText('ج.م 1234.00')).toBeTruthy()
    // "Customers" is both the page title and the card label.
    expect(screen.getAllByText('Customers').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('2')).toBeTruthy()
    expect(customersApi.overview).toHaveBeenCalledTimes(1)
  })

  it('renders the page even when the overview call fails', async () => {
    customersApi.overview.mockRejectedValue(new Error('boom'))
    renderPage()

    // Grid still shows; outstanding card falls back to zero, sales to —.
    expect(await screen.findByText('Acme')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('ج.م 0.00')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })
})

describe('CustomersPage — sort and badges', () => {
  it('sorts by total spent descending on request', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()

    // Default A-Z: Acme first. Flip to spent desc: Beta (9000) first.
    const sortTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent.includes('Name (A-Z)'))
    expect(sortTrigger).toBeTruthy()
    fireEvent.click(sortTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Total spent (high to low)' }))

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings.indexOf('Beta')).toBeLessThan(headings.indexOf('Acme'))
  })

  it('flags customers missing phone or email', async () => {
    renderPage()
    await screen.findByText('Acme')

    // Beta has neither; Acme has both.
    expect(screen.getByText('No phone')).toBeTruthy()
    expect(screen.getByText('No email')).toBeTruthy()
  })
})

describe('CustomersPage — quick actions', () => {
  it('offers Call/WhatsApp links only when a phone exists', async () => {
    renderPage()
    await screen.findByText('Acme')

    const waLinks = screen.getAllByRole('link', { name: /WhatsApp/ })
    expect(waLinks).toHaveLength(1)
    expect(waLinks[0].getAttribute('href')).toBe('https://wa.me/201011111111')
    const telLinks = screen.getAllByRole('link', { name: /Call/ })
    expect(telLinks).toHaveLength(1)
    expect(telLinks[0].getAttribute('href')).toBe('tel:+201011111111')
  })

  it('hands off to the POS with the customer id', async () => {
    renderPage()
    await screen.findByText('Acme')

    // Acme is first (A-Z sort), so its New Sale button carries id 1.
    fireEvent.click(screen.getAllByRole('button', { name: /New Sale/ })[0])

    expect(navigateMock).toHaveBeenCalledWith('/pos?new=1&customer=1')
  })
})

describe('CustomersPage — detail drawer (statement-backed)', () => {
  it('opens with statement stats, credit highlight, and the orders tab', async () => {
    renderPage()
    await screen.findByText('Acme')

    fireEvent.click(screen.getByRole('heading', { name: 'Acme' }))

    expect(await waitFor(() => expect(customerStatementsApi.getStatement).toHaveBeenCalledWith(1)))
    // Stats come from the statement's orders, not a client-side sum of a
    // single endpoint's rows.
    expect(await screen.findByText('Total Orders')).toBeTruthy()
    expect(screen.getByText('Total Spent')).toBeTruthy()
    expect(screen.getByText('ج.م 150.00')).toBeTruthy()
    // Open credit (40 remaining on the partial sale) is highlighted...
    expect(await screen.findByText('ج.م 40.00')).toBeTruthy()
    // ...and the statement's orders render on the default tab. Items are
    // behind the expandable row — open it to reach the line items.
    expect(screen.getByText('ORD-30')).toBeTruthy()
    fireEvent.click(screen.getByText('ORD-30'))
    expect(await screen.findByText('Gadget')).toBeTruthy()
    // No orders fetch — the statement endpoint replaced it.
    expect(subscriptionsApi.getAll).toHaveBeenCalledWith({ customer_id: 1 })
  })

  it('shows the credit tab with status, due date and remaining amount', async () => {
    renderPage()
    await screen.findByText('Acme')
    fireEvent.click(screen.getByRole('heading', { name: 'Acme' }))
    await screen.findByText('ORD-30')

    fireEvent.click(screen.getByRole('button', { name: 'Credit' }))

    expect(await screen.findByText('Partial')).toBeTruthy()
    expect(screen.getByText(/Order #29/)).toBeTruthy()
    expect(screen.getByText(/Due:/)).toBeTruthy()
    // Highlight row + credit-tab row both show the 40 remaining.
    expect(screen.getAllByText('ج.م 40.00').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the subscriptions tab with plan and status', async () => {
    renderPage()
    await screen.findByText('Acme')
    fireEvent.click(screen.getByRole('heading', { name: 'Acme' }))
    await screen.findByText('ORD-30')

    fireEvent.click(screen.getByRole('button', { name: 'Subscriptions' }))

    expect(await screen.findByText('Pro Plan')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('ج.م 300.00')).toBeTruthy()
  })

  it('survives a failing subscriptions call (statement still renders)', async () => {
    subscriptionsApi.getAll.mockRejectedValue(new Error('boom'))
    renderPage()
    await screen.findByText('Acme')
    fireEvent.click(screen.getByRole('heading', { name: 'Acme' }))

    expect(await screen.findByText('ORD-30')).toBeTruthy()
    // Empty-state for subs rather than a crashed drawer.
    fireEvent.click(screen.getByRole('button', { name: 'Subscriptions' }))
    expect(await screen.findByText('No subscriptions yet')).toBeTruthy()
  })
})
