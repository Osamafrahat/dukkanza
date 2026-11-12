import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Service Plans got the same catalogue shell as Services, plus a
// subscriber count per plan. The count is VALIDITY-AWARE: rows that have
// passed their end_date are history, not subscribers — the same rule the
// server's delete guard reports. Deleting a referenced plan answers 409
// (ON DELETE SET NULL would blank its history), and the dialog must stay
// open so the user can deactivate instead.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    authApi: { me: ok(null) },
    usersApi: { getAll: ok([]) },
    servicePlansApi: {
      getAll: ok([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    subscriptionsApi: { getAll: ok([]) },
  }
})

import ServicePlansPage from '../pages/ServicePlansPage'
import { servicePlansApi, subscriptionsApi } from '../lib/api'
import { useUserStore } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

const dayStr = (offset) => {
  const d = new Date(Date.now() + offset * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  useUserStore.setState({ currentUser: { id: 1, role: 'MANAGER', permissions: [] } })
  servicePlansApi.getAll.mockResolvedValue({
    data: [
      { id: 1, name: 'Pro Plan', name_ar: 'الخطة الاحترافية', price: 300, billing_cycle: 'monthly', duration_months: 12, features: ['Priority support'] },
      { id: 2, name: 'Basic', price: 100, billing_cycle: 'monthly', duration_months: 1, is_active: false },
    ],
  })
  subscriptionsApi.getAll.mockResolvedValue({
    data: [
      // Two rows reference plan 1, but the second one already ended —
      // only the first counts as a subscriber.
      { id: 11, plan_id: 1, status: 'active', end_date: dayStr(50) },
      { id: 12, plan_id: 1, status: 'active', end_date: dayStr(-5) },
      { id: 13, plan_id: 2, status: 'active', end_date: dayStr(200) },
    ],
  })
})

const renderPage = () => render(<MemoryRouter><ServicePlansPage /></MemoryRouter>)

const cardValue = (label) => {
  const labelEl = screen.getByText((content, el) => el.tagName === 'DIV' && content.trim() === label)
  return labelEl.parentElement.querySelector('p').textContent
}

describe('ServicePlansPage — summary cards', () => {
  it('shows plan, active and validity-aware subscriber counts', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Pro Plan' })

    expect(cardValue('Plans')).toBe('2')
    expect(cardValue('Active')).toBe('1') // Basic is inactive
    // 3 subscription rows exist, but one ended — 2 live subscribers.
    expect(cardValue('Subscribers')).toBe('2')
    expect(subscriptionsApi.getAll).toHaveBeenCalledWith({})
  })
})

describe('ServicePlansPage — per-plan subscriber chips', () => {
  it('counts only live subscriptions per plan', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Pro Plan' })

    const proCard = screen.getByRole('heading', { name: 'Pro Plan' }).closest('.bg-surface')
    const proChip = proCard.querySelector('[title="Subscribers"]')
    // Two referencing rows, one ended → 1.
    expect(proChip.textContent).toBe('1')

    const basicCard = screen.getByRole('heading', { name: 'Basic' }).closest('.bg-surface')
    const basicChip = basicCard.querySelector('[title="Subscribers"]')
    expect(basicChip.textContent).toBe('1')
  })

  it('survives a failing subscriptions fetch (plans still render)', async () => {
    subscriptionsApi.getAll.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Pro Plan' })).toBeTruthy()
    // The .catch in fetchPlans falls back to an empty list.
    expect(cardValue('Subscribers')).toBe('0')
  })
})

describe('ServicePlansPage — search', () => {
  it('filters plans and shows the no-matches branch', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Pro Plan' })

    fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'basic' } })
    expect(screen.getByRole('heading', { name: 'Basic' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Pro Plan' })).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'zzzz' } })
    expect(screen.getByText('No matches for your search')).toBeTruthy()
    expect(cardValue('Plans')).toBe('2')
  })
})

describe('ServicePlansPage — is_active toggle', () => {
  it('reactivates an inactive plan', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Pro Plan' })

    fireEvent.click(screen.getByTitle('Activate'))

    await waitFor(() => expect(servicePlansApi.update).toHaveBeenCalledWith(2, { is_active: true }))
  })
})

describe('ServicePlansPage — delete guard (409)', () => {
  it('keeps the dialog open and toasts the subscription count', async () => {
    servicePlansApi.delete.mockRejectedValue({
      response: { status: 409, data: { subscription_count: 3, error: 'Plan is used by 3 subscription(s) — deactivate it instead' } },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Pro Plan' })

    const proCard = screen.getByRole('heading', { name: 'Pro Plan' }).closest('.bg-surface')
    const buttons = proCard.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])

    expect(screen.getByRole('heading', { name: 'Delete Plan' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(servicePlansApi.delete).toHaveBeenCalledWith(1))
    // Dialog stays open — deactivation is the sanctioned alternative.
    expect(screen.getByRole('heading', { name: 'Delete Plan' })).toBeTruthy()
    const toast = useAppStore.getState().toasts.at(-1)
    expect(toast.type).toBe('error')
    expect(toast.message).toContain('Plan is used by 3 subscription(s)')
  })
})
