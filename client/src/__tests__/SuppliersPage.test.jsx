import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

// SuppliersPage shows the per-supplier AP balance (Remaining Balance) from
// GET /suppliers. The advance-balance row and its Record Advance modal left
// with the advance feature — these tests pin the surviving AP path and the
// absence of any advance UI.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    authApi: { me: ok(null) },
    usersApi: { getAll: ok([]) },
    suppliersApi: { getAll: ok([]), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
  suppliersApi.getAll.mockResolvedValue({
    data: [
      { id: 1, name: 'Acme', account_code: '20101', balance: 500 },
      { id: 2, name: 'Beta', account_code: null, balance: 0 },
    ],
  })
})

describe('SuppliersPage — AP balance', () => {
  it('shows Remaining Balance only for suppliers that have an AP account', async () => {
    render(<SuppliersPage />)

    // Acme carries account_code so its chip renders; Beta has none.
    expect(await screen.findAllByText('Remaining Balance:')).toHaveLength(1)
    expect(screen.getByText('500.00')).toBeTruthy()
  })

  it('renders no advance UI anywhere', async () => {
    render(<SuppliersPage />)

    await screen.findAllByText('Remaining Balance:')
    // The whole advance feature is gone: no row, no record button.
    expect(screen.queryByText('Advance Balance:')).toBeNull()
    expect(screen.queryAllByRole('button', { name: /Record Advance/ })).toHaveLength(0)
  })
})
