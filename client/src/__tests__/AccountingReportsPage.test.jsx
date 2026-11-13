import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react'

// Financial reports carries the report math into the UI:
//   - trial-balance rows must be TYPE-aware like the server totals: a
//     negative asset balance belongs in the CREDIT column, not dropped;
//   - balanced/unbalanced status + totals are the operator's main signal;
//   - the P&L date range must actually reach getProfitLoss;
//   - a failed load must toast, not fail silently.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    accountingReportsApi: {
      getTrialBalance: ok({}),
      getBalanceSheet: ok({}),
      getProfitLoss: ok({}),
      getFiscalPeriods: ok([]),
      getAccountLedger: ok({}),
      closeFiscalPeriod: ok({}),
    },
  }
})

import AccountingReportsPage from '../pages/AccountingReportsPage'
import { accountingReportsApi } from '../lib/api'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  accountingReportsApi.getFiscalPeriods.mockResolvedValue({ data: [] })
  accountingReportsApi.getTrialBalance.mockResolvedValue({
    data: {
      accounts: { asset: [], liability: [], equity: [], revenue: [], expense: [] },
      totalDebit: 0,
      totalCredit: 0,
      isBalanced: true,
    },
  })
})

const renderPage = () => render(<AccountingReportsPage />)

describe('AccountingReportsPage — trial balance', () => {
  it('shows balanced status and type-aware debit/credit columns', async () => {
    accountingReportsApi.getTrialBalance.mockResolvedValue({
      data: {
        accounts: {
          // Debit-normal with a negative balance → CREDIT column (server parity).
          asset: [{ id: 1, code: '1010', name: 'Cash', account_type: 'asset', balance: -50 }],
          liability: [{ id: 2, code: '2010', name: 'AP', account_type: 'liability', balance: 150 }],
          equity: [],
          revenue: [],
          // Debit-normal positive → DEBIT column.
          expense: [{ id: 3, code: '5010', name: 'Rent', account_type: 'expense', balance: 60 }],
        },
        totalDebit: 60,
        totalCredit: 200,
        isBalanced: false,
      },
    })
    renderPage()

    expect(await screen.findByText('Unbalanced')).toBeTruthy()

    const cellsOf = (code) => within(screen.getByText(code).closest('tr')).getAllByRole('cell')

    const assetCells = cellsOf('1010')
    expect(assetCells[2].textContent).toBe('')
    expect(assetCells[3].textContent).toBe('50.00')

    const liabCells = cellsOf('2010')
    expect(liabCells[2].textContent).toBe('')
    expect(liabCells[3].textContent).toBe('150.00')

    const expenseCells = cellsOf('5010')
    expect(expenseCells[2].textContent).toBe('60.00')
    expect(expenseCells[3].textContent).toBe('')
  })

  it('flags a balanced report and exposes the totals as cards', async () => {
    accountingReportsApi.getTrialBalance.mockResolvedValue({
      data: {
        accounts: { asset: [], liability: [], equity: [], revenue: [], expense: [] },
        totalDebit: 100,
        totalCredit: 100,
        isBalanced: true,
      },
    })
    renderPage()

    expect(await screen.findByText('Balanced')).toBeTruthy()
    expect(screen.getByText('Total Debit').nextElementSibling.textContent).toBe('100.00')
    expect(screen.getByText('Total Credit').nextElementSibling.textContent).toBe('100.00')
  })

  it('toasts a failed report load instead of failing silently', async () => {
    accountingReportsApi.getTrialBalance.mockRejectedValue({
      response: { data: { error: 'boom' } },
    })
    renderPage()

    await waitFor(() => {
      expect(
        useAppStore.getState().toasts.some((t) => t.type === 'error' && t.message === 'boom')
      ).toBe(true)
    })
  })
})

describe('AccountingReportsPage — profit & loss date range', () => {
  it('refetches getProfitLoss when the date range changes', async () => {
    accountingReportsApi.getProfitLoss.mockResolvedValue({
      data: { revenues: [], expenses: [], totalRevenue: 0, totalExpenses: 0, netIncome: 0 },
    })
    renderPage()
    await screen.findByText('Balanced')

    fireEvent.click(screen.getByRole('button', { name: /Profit & Loss/ }))
    await waitFor(() => expect(accountingReportsApi.getProfitLoss).toHaveBeenCalledTimes(1))
    expect(accountingReportsApi.getProfitLoss).toHaveBeenCalledWith({
      date_from: undefined,
      date_to: undefined,
    })

    // Each date change refetches, and the refetch swaps the content for the
    // loading spinner — so wait for the inputs to remount before the next edit.
    fireEvent.change(await screen.findByLabelText('Start Date'), { target: { value: '2026-01-01' } })
    fireEvent.change(await screen.findByLabelText('End Date'), { target: { value: '2026-01-31' } })

    await waitFor(() =>
      expect(accountingReportsApi.getProfitLoss).toHaveBeenLastCalledWith({
        date_from: '2026-01-01',
        date_to: '2026-01-31',
      })
    )
  })

  it('labels a negative result as Net Loss', async () => {
    accountingReportsApi.getProfitLoss.mockResolvedValue({
      data: { revenues: [], expenses: [], totalRevenue: 0, totalExpenses: 500, netIncome: -500 },
    })
    renderPage()
    await screen.findByText('Balanced')

    fireEvent.click(screen.getByRole('button', { name: /Profit & Loss/ }))

    // Appears in the summary card and the footer row.
    expect((await screen.findAllByText('Net Loss')).length).toBeGreaterThan(0)
  })
})
