import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
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
  }
})

import ServicesPage from '../pages/ServicesPage'
import { servicesApi } from '../lib/api'
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
