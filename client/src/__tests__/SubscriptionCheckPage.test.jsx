import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The page reads exactly one API surface; stub it so no axios call escapes.
vi.mock('../lib/api', () => ({
  subscriptionsApi: { getById: vi.fn() },
}))

import { subscriptionsApi } from '../lib/api'
import SubscriptionCheckPage from '../pages/SubscriptionCheckPage'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

const renderPage = () => render(
  <MemoryRouter>
    <SubscriptionCheckPage />
  </MemoryRouter>
)

const typeAndCheck = async (utils, value) => {
  fireEvent.change(utils.getByPlaceholderText('SUB-123'), { target: { value } })
  fireEvent.click(utils.getByRole('button', { name: /Check/ }))
}

// Shape returned by GET /subscriptions/:id.
const activeSub = {
  id: 42,
  status: 'active',
  start_date: '2026-01-01',
  end_date: '2027-01-01', // future relative to the test run
  billing_amount: 150,
  customer: { id: 1, name: 'Ahmed Ali' },
  plan: { id: 3, name: 'Gold' },
  service: { id: 2, name: 'Internet' },
}

describe('SubscriptionCheckPage', () => {
  it('shows Valid for an active subscription with a future end date', async () => {
    subscriptionsApi.getById.mockResolvedValue({ data: activeSub })

    const utils = renderPage()
    await typeAndCheck(utils, 'SUB-42')

    await waitFor(() => expect(utils.getByText('Valid')).toBeTruthy())
    expect(subscriptionsApi.getById).toHaveBeenCalledWith(42)
    expect(utils.getByText('Ahmed Ali')).toBeTruthy()
    expect(utils.getByText('Gold')).toBeTruthy()
    expect(utils.getByText('SUB-42')).toBeTruthy()
  })

  it('shows Expired when the end date has passed even though status is active', async () => {
    // Nothing auto-expires rows: status stays 'active' after end_date —
    // the whole point of computing the verdict.
    subscriptionsApi.getById.mockResolvedValue({
      data: { ...activeSub, end_date: '2026-01-01' },
    })

    const utils = renderPage()
    await typeAndCheck(utils, 'SUB-42')

    await waitFor(() => expect(utils.getByText('Expired')).toBeTruthy())
    // Stored status is still displayed as-is, beside the computed verdict.
    expect(utils.getByText('Active')).toBeTruthy()
  })

  it('reports not-found with the scanned code and does not clear on format errors', async () => {
    subscriptionsApi.getById.mockRejectedValue({ response: { status: 404 } })

    const utils = renderPage()
    await typeAndCheck(utils, 'SUB-9')

    await waitFor(() =>
      expect(utils.getByText('No subscription found for SUB-9')).toBeTruthy()
    )
    // A lookup was attempted, so the input cleared for the next scan.
    expect(utils.getByPlaceholderText('SUB-123').value).toBe('')
  })

  it('rejects a malformed barcode without calling the API', async () => {
    const utils = renderPage()
    await typeAndCheck(utils, 'GARBAGE')

    await waitFor(() =>
      expect(utils.getByText('Invalid subscription barcode')).toBeTruthy()
    )
    expect(subscriptionsApi.getById).not.toHaveBeenCalled()
    // Kept the typed text so a manual typo can be corrected.
    expect(utils.getByPlaceholderText('SUB-123').value).toBe('GARBAGE')
  })

  it('accepts a scanner CR/LF suffix and a bare id', async () => {
    subscriptionsApi.getById.mockResolvedValue({ data: activeSub })

    const utils = renderPage()
    fireEvent.change(utils.getByPlaceholderText('SUB-123'), {
      target: { value: 'SUB-42\r\n' },
    })
    fireEvent.click(utils.getByRole('button', { name: /Check/ }))

    await waitFor(() => expect(utils.getByText('Valid')).toBeTruthy())
    expect(subscriptionsApi.getById).toHaveBeenCalledWith(42)
  })
})
