import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Services got the catalogue shell the Suppliers/Customers pages have:
// summary cards, client-side search + sort, an is_active toggle (POS hides
// inactive rows — this is the admin side of that filter), a bilingual
// name/name_ar display, and a 409-aware delete (the server blocks deleting
// a service that subscriptions reference, because ON DELETE SET NULL would
// blank their history). These tests pin each of those behaviors.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    authApi: { me: ok(null) },
    usersApi: { getAll: ok([]) },
    servicesApi: {
      getAll: ok([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    // Feeds the detail drawer (subscribers + collected revenue).
    subscriptionsApi: {
      getAll: ok([]),
      getAllPayments: ok([]),
    },
  }
})

import ServicesPage from '../pages/ServicesPage'
import { servicesApi, subscriptionsApi } from '../lib/api'
import { useUserStore } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  // MANAGER passes hasPermission for everything — the canEdit path.
  useUserStore.setState({ currentUser: { id: 1, role: 'MANAGER', permissions: [] } })
  servicesApi.getAll.mockResolvedValue({
    data: [
      // Default sort A-Z: Alpha first. Price sort desc: Beta first.
      { id: 1, name: 'Alpha', name_ar: 'ألفا', price: 100, service_type: 'maintenance', is_active: true },
      { id: 2, name: 'Beta', price: 500, service_type: 'warranty', is_active: false },
      { id: 3, name: 'Gamma', price: 200, service_type: 'custom' },
    ],
  })
})

const renderPage = () => render(<MemoryRouter><ServicesPage /></MemoryRouter>)

// The label sits in a div, the value in the card's <p> sibling — this
// avoids ambiguity where the value ("2") also appears inside prices.
const cardValue = (label) => {
  const labelEl = screen.getByText((content, el) => el.tagName === 'DIV' && content.trim() === label)
  return labelEl.parentElement.querySelector('p').textContent
}

describe('ServicesPage — summary cards', () => {
  it('shows total, active and inactive counts', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    expect(cardValue('Services')).toBe('3')
    expect(cardValue('Active')).toBe('2')
    expect(cardValue('Inactive')).toBe('1')
    expect(servicesApi.getAll).toHaveBeenCalledTimes(1)
  })

  it('badges and dims inactive services (POS hides them)', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    // Beta carries the badge; the summary label is the div, the badge a span.
    expect(screen.getByText((content, el) => el.tagName === 'SPAN' && content.trim() === 'Inactive')).toBeTruthy()
    const betaCard = screen.getByRole('heading', { name: 'Beta' }).closest('.bg-surface')
    expect(betaCard.className).toContain('opacity-60')
    const alphaCard = screen.getByRole('heading', { name: 'Alpha' }).closest('.bg-surface')
    expect(alphaCard.className).not.toContain('opacity-60')
  })
})

describe('ServicesPage — search and sort', () => {
  it('filters by name and shows the no-matches branch', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'beta' } })
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Alpha' })).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'zzzz' } })
    expect(screen.getByText('No matches for your search')).toBeTruthy()
    // Cards gone, summary cards still show the full set.
    expect(screen.queryByRole('heading', { name: 'Beta' })).toBeNull()
    expect(cardValue('Services')).toBe('3')
  })

  it('sorts by price descending on request', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    const sortTrigger = screen.getByRole('combobox')
    expect(sortTrigger.textContent).toContain('Name (A-Z)')
    fireEvent.click(sortTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Price (high to low)' }))

    const names = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(names.indexOf('Beta')).toBeLessThan(names.indexOf('Gamma'))
    expect(names.indexOf('Gamma')).toBeLessThan(names.indexOf('Alpha'))
  })
})

describe('ServicesPage — is_active toggle', () => {
  it('reactivates an inactive service', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    // Beta is the only inactive card → its Power button reads "Activate".
    fireEvent.click(screen.getByTitle('Activate'))

    await waitFor(() => expect(servicesApi.update).toHaveBeenCalledWith(2, { is_active: true }))
    // Refetch follows the toggle.
    await waitFor(() => expect(servicesApi.getAll).toHaveBeenCalledTimes(2))
  })
})

describe('ServicesPage — bilingual display and form', () => {
  it('shows the Arabic name as a secondary line under the English one', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    // language 'en': heading = name, secondary line = name_ar.
    expect(screen.getByText('ألفا')).toBeTruthy()
    // Beta has no name_ar → no secondary line, only the badge.
    const betaCard = screen.getByRole('heading', { name: 'Beta' }).closest('.bg-surface')
    expect(betaCard.textContent).not.toContain('عربي')
  })

  it('offers a right-to-left Name (Arabic) field in the form', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    fireEvent.click(screen.getByRole('button', { name: /Add Service/ }))

    expect(screen.getByRole('heading', { name: 'Add Service' })).toBeTruthy()
    const arLabel = screen.getByText('Name (Arabic)')
    const arInput = arLabel.nextElementSibling
    expect(arInput.tagName).toBe('INPUT')
    expect(arInput.getAttribute('dir')).toBe('rtl')
  })
})

describe('ServicesPage — delete guard (409)', () => {
  it('keeps the dialog open and toasts the subscription count', async () => {
    servicesApi.delete.mockRejectedValue({
      response: { status: 409, data: { subscription_count: 3, error: 'Service is used by 3 subscription(s) — deactivate it instead' } },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    const alphaCard = screen.getByRole('heading', { name: 'Alpha' }).closest('.bg-surface')
    const buttons = alphaCard.querySelectorAll('button')
    // [toggle, edit, delete] — the delete button is the last one.
    fireEvent.click(buttons[buttons.length - 1])

    expect(screen.getByRole('heading', { name: 'Delete Service' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(servicesApi.delete).toHaveBeenCalledWith(1))
    // Dialog stays open (deleteTarget not cleared) so the user can deactivate instead.
    expect(screen.getByRole('heading', { name: 'Delete Service' })).toBeTruthy()
    const toast = useAppStore.getState().toasts.at(-1)
    expect(toast.type).toBe('error')
    expect(toast.message).toContain('Service is used by 3 subscription(s)')
  })
})

describe('ServicesPage — detail drawer', () => {
  const dayStr = (offset) => {
    const d = new Date(Date.now() + offset * 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  it('opens from the card name with subscribers, revenue and the cross-link', async () => {
    subscriptionsApi.getAll.mockResolvedValue({
      data: [
        // Live subscriber (ends in 30 days)...
        { id: 7, service_id: 1, status: 'active', start_date: '2026-01-01', end_date: dayStr(30), billing_amount: 90, customer: { id: 1, name: 'Acme' } },
        // ...and one that already ended (history, not a subscriber).
        { id: 8, service_id: 1, status: 'active', start_date: '2026-01-01', end_date: dayStr(-3), billing_amount: 90, customer: { id: 2, name: 'Beta' } },
        // Belongs to another service — must not leak into this drawer.
        { id: 9, service_id: 3, status: 'active', start_date: '2026-01-01', end_date: dayStr(30), billing_amount: 90, customer: { id: 3, name: 'Gamma Co' } },
      ],
    })
    subscriptionsApi.getAllPayments.mockResolvedValue({
      data: [
        { id: 1, amount: 40, subscription: { service_id: 1 } },
        { id: 2, amount: 50, subscription: { service_id: 1 } },
        { id: 3, amount: 999, subscription: { service_id: 3 } },
      ],
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    fireEvent.click(screen.getByRole('heading', { name: 'Alpha' }))

    const drawerHeading = await screen.findByRole('heading', { level: 2, name: 'Alpha' })
    expect(subscriptionsApi.getAll).toHaveBeenCalledWith({})
    expect(subscriptionsApi.getAllPayments).toHaveBeenCalledTimes(1)

    // Revenue = payments pointing at service 1 (40 + 50), not service 3's 999.
    // (Scoped to the stat card: a subscriber row also shows '90 EGP'.)
    const drawer = drawerHeading.closest('div.fixed')
    const paidLabel = within(drawer).getByText((content, el) => el.tagName === 'DIV' && content.trim() === 'Total Paid')
    expect(paidLabel.parentElement.querySelector('p').textContent).toBe('90 EGP')
    // Validity-aware live count: the ended row doesn't count.
    const statLabel = within(drawer).getByText((content, el) => el.tagName === 'DIV' && content.trim() === 'Subscribers')
    expect(statLabel.parentElement.querySelector('p').textContent).toBe('1')
    // Both service-1 rows are listed, with validity pills; the other service's isn't.
    expect(within(drawer).getByText('Acme')).toBeTruthy()
    expect(within(drawer).getByText('Beta')).toBeTruthy()
    expect(screen.queryByText('Gamma Co')).toBeNull()
    expect(within(drawer).getByText('Valid')).toBeTruthy()
    expect(within(drawer).getByText('Expired')).toBeTruthy()

    const link = screen.getByRole('link', { name: /View in Subscriptions/ })
    expect(link.getAttribute('href')).toBe('/subscriptions?service=1')
  })

  it('shows the empty-subscriber branch for a service nobody bought', async () => {
    subscriptionsApi.getAll.mockResolvedValue({ data: [] })
    subscriptionsApi.getAllPayments.mockResolvedValue({ data: [] })
    renderPage()
    await screen.findByRole('heading', { name: 'Alpha' })

    fireEvent.click(screen.getByRole('heading', { name: 'Alpha' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Alpha' })).toBeTruthy()
    expect(await screen.findByText('No subscriptions yet')).toBeTruthy()
    // Revenue resolves to zero rather than hanging on the dash.
    expect(await screen.findByText('0 EGP')).toBeTruthy()
  })
})
