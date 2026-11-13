import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The chart of accounts is the accounting shell's filter surface:
//   - search/type/status/sort must all filter ONE unfiltered fetch (a
//     server-side param here would double-filter and hide rows);
//   - account names resolve through accounting.account.<code> so the AR
//     locale can override the raw row name;
//   - DELETE must honour the server's 409 in-use guard — the client shows
//     the count-bearing message instead of the generic error;
//   - the ledger drawer links back into journals by account code.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    default: { post: vi.fn().mockResolvedValue({ data: {} }) },
    accountsApi: {
      getAll: ok([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      seed: vi.fn(),
      setInitialCapital: vi.fn(),
    },
    accountingReportsApi: { getAccountLedger: ok({ account: {}, transactions: [] }) },
  }
})

import ChartOfAccountsPage from '../pages/ChartOfAccountsPage'
import { accountsApi, accountingReportsApi } from '../lib/api'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  accountsApi.getAll.mockResolvedValue({
    data: [
      // 1010 has an accounting.account.1010 translation — the row must show
      // 'Cash on Hand', not the raw row name 'Cash'.
      { id: 1, code: '1010', name: 'Cash', account_type: 'asset', balance: 500, is_active: true },
      // No translation key for 9999 — falls back to the raw name.
      { id: 2, code: '9999', name: 'Suspense', account_type: 'liability', balance: 200, is_active: false },
    ],
  })
  accountsApi.update.mockResolvedValue({ data: {} })
  accountsApi.delete.mockResolvedValue({ data: {} })
  accountingReportsApi.getAccountLedger.mockResolvedValue({
    data: {
      account: { id: 1, code: '1010', account_type: 'asset', balance: 500 },
      transactions: [
        { id: 11, debit: 600, credit: 0, balance: 600, description: '', journal_entries: { entry_number: 'JE-1', date: '2026-01-01', description: 'Capital' } },
        { id: 12, debit: 0, credit: 100, balance: 500, description: '', journal_entries: { entry_number: 'JE-2', date: '2026-01-02', description: 'Expense' } },
      ],
    },
  })
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <ChartOfAccountsPage />
    </MemoryRouter>
  )

describe('ChartOfAccountsPage — fetch and summary cards', () => {
  it('fetches once without params and renders bilingual rows plus cards', async () => {
    renderPage()
    await screen.findByText('9999')

    // Single unfiltered fetch: filtering is entirely client-side.
    expect(accountsApi.getAll).toHaveBeenCalledTimes(1)
    expect(accountsApi.getAll).toHaveBeenCalledWith()

    // Bilingual name resolution: translated key wins, raw name is the fallback.
    expect(screen.getByText('Cash on Hand')).toBeTruthy()
    expect(screen.getByText('Suspense')).toBeTruthy()

    expect(screen.getByText(/Total\s*accounts/).nextElementSibling.textContent).toBe('2')
    expect(screen.getByText('With Balance').nextElementSibling.textContent).toBe('2')
    expect(screen.getByText(/Active\s*\/\s*Inactive/).nextElementSibling.textContent).toBe('1 / 1')
    expect(screen.getByText('700.00 EGP')).toBeTruthy()
  })
})

describe('ChartOfAccountsPage — client-side status filter', () => {
  it('hides rows that do not match the selected status', async () => {
    renderPage()
    await screen.findByText('9999')

    // Three comboboxes in the filter row: type ('All Types'), status ('All'),
    // sort ('Code (A-Z)'). Exact match picks the status trigger.
    const statusTrigger = screen.getAllByRole('combobox').find((el) => el.textContent.trim() === 'All')
    expect(statusTrigger).toBeTruthy()
    fireEvent.click(statusTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }))

    expect(screen.getByText('9999')).toBeTruthy()
    expect(screen.queryByText('1010')).toBeNull()
    expect(screen.queryByText('Cash on Hand')).toBeNull()
  })
})

describe('ChartOfAccountsPage — row actions', () => {
  it('toggles is_active through the PUT whitelist', async () => {
    renderPage()
    await screen.findByText('9999')

    // Only the active account (1010) offers a 'Deactivate' toggle.
    fireEvent.click(screen.getByTitle('Deactivate'))

    await waitFor(() =>
      expect(accountsApi.update).toHaveBeenCalledWith(1, { is_active: false })
    )
    await waitFor(() => {
      expect(useAppStore.getState().toasts.some((t) => t.message === 'Account updated')).toBe(true)
    })
  })

  it('shows the count-bearing 409 message when the account is in use', async () => {
    accountsApi.delete.mockRejectedValue({
      response: { status: 409, data: { entry_count: 3 } },
    })
    renderPage()
    await screen.findByText('9999')

    const row = screen.getByText('9999').closest('tr')
    const buttons = within(row).getAllByRole('button')
    // [ledger, toggle, edit, delete] — delete is the icon-only trash button.
    fireEvent.click(buttons[buttons.length - 1])
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(
        toasts.some(
          (t) =>
            t.type === 'error' &&
            t.message === 'Account is used by 3 journal line(s) - deactivate instead'
        )
      ).toBe(true)
    })
    // The guard fired client-side — no refetch after a refused delete.
    expect(accountsApi.getAll).toHaveBeenCalledTimes(1)
  })
})

describe('ChartOfAccountsPage — AccountDetailDrawer', () => {
  it('opens the ledger with running balances and a journals deep link', async () => {
    renderPage()
    await screen.findByText('9999')

    // Both rows have a ledger button — scope to the 1010 row.
    const row = screen.getByText('1010').closest('tr')
    fireEvent.click(within(row).getByTitle('Account Ledger'))

    await waitFor(() => expect(accountingReportsApi.getAccountLedger).toHaveBeenCalledWith(1))

    // Ledger rows render once loaded (newest first, each with its balance).
    expect(await screen.findByText('JE-2')).toBeTruthy()
    expect(screen.getByText('JE-1')).toBeTruthy()
    expect(screen.getByText('Total Entries').nextElementSibling.textContent).toBe('2')

    const link = screen.getByRole('link', { name: /View in Journal Entries/ })
    expect(link.getAttribute('href')).toBe('/accounting/journals?search=1010')
  })
})
