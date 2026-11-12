import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Subscriptions moved from per-status server fetches to ONE fetch of the
// whole set with client-side filtering, so the summary cards always see
// every row. On top of that this suite pins:
//   - the four summary cards (active / expiring-30d / monthly billing / past due),
//   - the customer cell's cross-links (customers deep link, tel:, wa.me),
//   - the /subscriptions?customer=<id> deep link from the customer drawer,
//   - the renew modal's payment method (the server used to hardcode 'cash'),
//   - the renewal-due pill and the form's service selector.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    authApi: { me: ok(null) },
    usersApi: { getAll: ok([]) },
    subscriptionsApi: {
      getAll: ok([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      cancel: vi.fn(),
      renew: vi.fn(),
      getPayments: ok([]),
      recordPayment: vi.fn(),
    },
    servicesApi: { getAll: ok([]) },
    servicePlansApi: { getAll: ok([]) },
    customersApi: { getAll: ok([]) },
  }
})

import SubscriptionsPage from '../pages/SubscriptionsPage'
import { subscriptionsApi, servicesApi, servicePlansApi, customersApi } from '../lib/api'
import { useUserStore } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

// Dates are relative to "now" so the expiring/renewal windows never rot.
const dayStr = (offset) => {
  const d = new Date(Date.now() + offset * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ACME = { id: 1, name: 'Acme', phone: '+201011111111' }
const BETA = { id: 9, name: 'Beta', phone: '+201022222222' }

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  useUserStore.setState({ currentUser: { id: 1, role: 'MANAGER', permissions: [] } })

  customersApi.getAll.mockResolvedValue({ data: [ACME, BETA] })
  servicesApi.getAll.mockResolvedValue({ data: [{ id: 5, name: 'Cleanup', price: 50 }] })
  servicePlansApi.getAll.mockResolvedValue({
    data: [{ id: 1, name: 'Pro Plan', price: 300, billing_cycle: 'monthly', duration_months: 12 }],
  })
  subscriptionsApi.getAll.mockResolvedValue({
    data: [
      {
        id: 1, customer_id: 1, plan_id: 1, status: 'active',
        start_date: dayStr(-30), end_date: dayStr(10), next_billing_date: dayStr(-1),
        billing_amount: 300, created_at: '2026-11-01T00:00:00.000Z',
        customer: ACME, plan: { name: 'Pro Plan' }, service: null,
      },
      {
        id: 2, customer_id: 9, plan_id: 1, status: 'active',
        start_date: dayStr(-60), end_date: dayStr(200), next_billing_date: dayStr(30),
        billing_amount: 100, created_at: '2026-10-01T00:00:00.000Z',
        customer: BETA, plan: { name: 'Pro Plan' }, service: null,
      },
      {
        id: 3, customer_id: 1, service_id: 5, status: 'past_due',
        start_date: dayStr(-90), end_date: dayStr(60), next_billing_date: dayStr(-5),
        billing_amount: 50, created_at: '2026-09-01T00:00:00.000Z',
        customer: ACME, plan: null, service: { name: 'Cleanup' },
      },
      {
        id: 4, customer_id: 9, plan_id: 1, status: 'cancelled',
        start_date: dayStr(-120), end_date: dayStr(-10),
        billing_amount: 70, created_at: '2026-08-01T00:00:00.000Z',
        customer: BETA, plan: { name: 'Pro Plan' }, service: null,
      },
    ],
  })
})

const renderPage = (entries = ['/subscriptions']) =>
  render(<MemoryRouter initialEntries={entries}><SubscriptionsPage /></MemoryRouter>)

const cardValue = (label) => {
  const labelEl = screen.getByText((content, el) => el.tagName === 'DIV' && content.trim() === label)
  return labelEl.parentElement.querySelector('p').textContent
}

describe('SubscriptionsPage — single fetch + summary cards', () => {
  it('fetches the whole set once with an empty filter', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    expect(subscriptionsApi.getAll).toHaveBeenCalledTimes(1)
    expect(subscriptionsApi.getAll).toHaveBeenCalledWith({})
    // Lookups for the form/selects come along in the same round trip.
    expect(customersApi.getAll).toHaveBeenCalledTimes(1)
    expect(servicesApi.getAll).toHaveBeenCalledTimes(1)
    expect(servicePlansApi.getAll).toHaveBeenCalledTimes(1)
  })

  it('shows active, expiring-30d, monthly billing and past due', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    expect(cardValue('Active')).toBe('2') // subs 1 + 2
    expect(cardValue('Expiring (30d)')).toBe('1') // sub 1 ends in 10 days
    expect(cardValue('Monthly billing')).toBe('450 EGP') // active + past_due
    expect(cardValue('Past Due')).toBe('1') // sub 3
  })

  it('marks renewal-due rows with the pill', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    // Sub 1 (next billing yesterday) and sub 3 (past_due, billing 5d ago).
    expect(screen.getAllByText('Renewal due').length).toBeGreaterThanOrEqual(1)
  })
})

describe('SubscriptionsPage — client-side filtering', () => {
  it('filters by status without refetching', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }))
    expect(screen.getAllByRole('link', { name: 'Beta' })).toHaveLength(1) // sub 4 only
    expect(screen.queryByRole('link', { name: 'Acme' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getAllByRole('link', { name: 'Beta' })).toHaveLength(2)
    // Still one fetch — cards keep seeing the full set.
    expect(subscriptionsApi.getAll).toHaveBeenCalledTimes(1)
  })

  it('filters to expiring rows via the chip', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    // The filter chip (its accessible name is exactly the label).
    fireEvent.click(screen.getByRole('button', { name: 'Expiring (30d)' }))
    // Only sub 1 (Acme, ends in 10 days) survives; Beta's rows drop out.
    expect(screen.getAllByRole('link', { name: 'Acme' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull()
    // Cards unchanged: the filter never touched the fetch.
    expect(cardValue('Active')).toBe('2')
  })

  it('searches across customer, phone, plan and service names', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    const input = screen.getByPlaceholderText('Search by customer or phone...')
    fireEvent.change(input, { target: { value: 'cleanup' } })
    // Only the service-backed sub (3) remains — its customer link still renders once.
    expect(screen.getAllByRole('link', { name: 'Acme' })).toHaveLength(1)

    fireEvent.change(input, { target: { value: 'zzzz' } })
    expect(screen.getByText('No matches for your search')).toBeTruthy()
  })
})

describe('SubscriptionsPage — customer cell cross-links', () => {
  it('links to the customer drawer, tel: and wa.me', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    const customerLinks = screen.getAllByRole('link', { name: 'Acme' })
    expect(customerLinks).toHaveLength(2) // subs 1 and 3
    expect(customerLinks[0].getAttribute('href')).toBe('/customers?search=Acme')

    const telLinks = screen.getAllByRole('link', { name: 'Call' })
    expect(telLinks).toHaveLength(4) // every row has a phone
    expect(telLinks[0].getAttribute('href')).toBe('tel:+201011111111')

    const waLinks = screen.getAllByRole('link', { name: 'WhatsApp' })
    expect(waLinks[0].getAttribute('href')).toBe('https://wa.me/201011111111')
    expect(waLinks[1].getAttribute('href')).toBe('https://wa.me/201022222222')
  })
})

describe('SubscriptionsPage — customer deep link', () => {
  it('applies ?customer=<id> as a removable filter chip', async () => {
    renderPage(['/subscriptions?customer=9'])

    expect(await screen.findByText((content, el) => el.tagName === 'BUTTON' && content.includes('Customer: Beta'))).toBeTruthy()
    // Only Beta's rows (subs 2 and 4).
    expect(screen.queryByRole('link', { name: 'Acme' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Beta' })).toHaveLength(2)
    // One fetch — the deep link is a filter, not a query param.
    expect(subscriptionsApi.getAll).toHaveBeenCalledWith({})
    expect(subscriptionsApi.getAll).toHaveBeenCalledTimes(1)
  })
})

describe('SubscriptionsPage — renew modal', () => {
  it('renews with the chosen payment method', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })
    subscriptionsApi.renew.mockResolvedValue({ data: {} })

    // Renew buttons exist for every non-cancelled row; newest first → sub 1.
    fireEvent.click(screen.getAllByTitle('Renew')[0])

    expect(screen.getByRole('heading', { name: 'Renew Subscription' })).toBeTruthy()
    expect(screen.getByText('Payment method')).toBeTruthy()

    // Pick Card from the modal's select (the page's sort combobox is first).
    const comboboxes = screen.getAllByRole('combobox')
    fireEvent.click(comboboxes[comboboxes.length - 1])
    fireEvent.click(screen.getByRole('button', { name: 'Card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(subscriptionsApi.renew).toHaveBeenCalledWith(1, { payment_method: 'card' }))
    // Modal closes after a successful renew.
    expect(screen.queryByRole('heading', { name: 'Renew Subscription' })).toBeNull()
  })

  it('defaults the method to cash', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })
    subscriptionsApi.renew.mockResolvedValue({ data: {} })

    fireEvent.click(screen.getAllByTitle('Renew')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(subscriptionsApi.renew).toHaveBeenCalledWith(1, { payment_method: 'cash' }))
  })

  it('offers renew to a past_due row (the old UI hid all actions)', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    // Sub 3 is past_due — it now has a renew button alongside subs 1 and 2.
    expect(screen.getAllByTitle('Renew')).toHaveLength(3)
    // The cancelled row (sub 4) still has none.
    expect(screen.getAllByTitle('Cancel')).toHaveLength(3)
  })
})

describe('SubscriptionsPage — add form', () => {
  it('offers a service selector next to the plan selector', async () => {
    renderPage()
    await screen.findAllByRole('link', { name: 'Acme' })

    fireEvent.click(screen.getByRole('button', { name: /Add Subscription/ }))

    expect(screen.getByRole('heading', { name: 'Add Subscription' })).toBeTruthy()
    expect(screen.getByText('Service')).toBeTruthy()
    // The service combobox preselects its empty "Select service" option.
    expect(screen.getByText('Select service')).toBeTruthy()
    // Lookups arrived with the page's single fetch round trip.
    expect(servicesApi.getAll).toHaveBeenCalledTimes(1)
  })
})
