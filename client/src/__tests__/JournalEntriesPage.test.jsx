import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Journal entries is the filter + protection surface:
//   - other pages deep-link into it (?search=<account code>) — the param must
//     seed both the input AND the first API call;
//   - date range / source type filters are passed straight through;
//   - the form's balanced indicator was a mojibake string ('âœ“ Balanced');
//     it must now come from the translation key.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    journalsApi: {
      getAll: ok({ data: { data: [], total: 0 } }),
      create: vi.fn(),
      reverse: vi.fn(),
    },
    accountsApi: { getAll: ok([]) },
  }
})

import JournalEntriesPage from '../pages/JournalEntriesPage'
import { journalsApi } from '../lib/api'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  journalsApi.getAll.mockResolvedValue({ data: { data: [], total: 0 } })
  journalsApi.create.mockResolvedValue({ data: { id: 1 } })
})

const ENTRY = {
  id: 1,
  entry_number: 'JE-1',
  date: '2026-01-15',
  description: 'Sale - Order #123',
  source_type: 'order',
  is_posted: true,
  is_reversed: false,
  journal_entry_lines: [
    { debit: 100, credit: 0 },
    { debit: 0, credit: 100 },
  ],
}

const renderPage = (initialEntries = ['/accounting/journals']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <JournalEntriesPage />
    </MemoryRouter>
  )

describe('JournalEntriesPage — deep link', () => {
  it('seeds the search filter from ?search= and sends it to the API', async () => {
    renderPage(['/accounting/journals?search=JE-1'])

    await waitFor(() =>
      expect(journalsApi.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'JE-1' })
      )
    )
    expect(screen.getByDisplayValue('JE-1')).toBeTruthy()
  })
})

describe('JournalEntriesPage — filters', () => {
  it('passes date range and source type through to the API', async () => {
    renderPage()
    await waitFor(() => expect(journalsApi.getAll).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-01-31' } })

    const sourceTrigger = screen.getAllByRole('combobox').find((el) => el.textContent.trim() === 'All')
    expect(sourceTrigger).toBeTruthy()
    fireEvent.click(sourceTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Sale' }))

    await waitFor(() =>
      expect(journalsApi.getAll).toHaveBeenLastCalledWith(
        expect.objectContaining({
          date_from: '2026-01-01',
          date_to: '2026-01-31',
          source_type: 'order',
        })
      )
    )
  })

  it('clears every filter and refetches unfiltered', async () => {
    renderPage()
    await waitFor(() => expect(journalsApi.getAll).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-02-01' } })
    await waitFor(() => expect(journalsApi.getAll).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => {
      const last = journalsApi.getAll.mock.calls.at(-1)[0]
      expect(last.date_from).toBeUndefined()
      expect(last.date_to).toBeUndefined()
      expect(last.source_type).toBeUndefined()
      expect(last.search).toBeUndefined()
    })
  })
})

describe('JournalEntriesPage — summary cards and list', () => {
  it('shows total/list counts and the active-filter summary', async () => {
    journalsApi.getAll.mockResolvedValue({ data: { data: [ENTRY], total: 42 } })
    renderPage()

    await screen.findByText('JE-1')

    expect(screen.getByText('Total Entries').nextElementSibling.textContent).toBe('42')
    expect(screen.getByText('On this page').nextElementSibling.textContent).toBe('1')
    expect(screen.getByText('Filters').nextElementSibling.textContent).toBe('None')
    // Source badge resolves through the accounting.source* key.
    expect(screen.getByText('Sale')).toBeTruthy()
  })
})

describe('JournalEntriesPage — create form', () => {
  it('shows the translated balanced indicator and saves a balanced entry', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /New Entry/ }))

    fireEvent.change(screen.getByPlaceholderText('Description'), {
      target: { value: 'Test entry' },
    })
    // Two lines, each with debit/credit inputs (placeholder '0') in DOM order.
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '100' } })
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '100' } })

    // The mojibake 'âœ“ Balanced' is gone — the label comes from the key now.
    expect(await screen.findByText('Balanced')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() =>
      expect(journalsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Test entry' })
      )
    )
    await waitFor(() => {
      expect(
        useAppStore.getState().toasts.some((t) => t.message === 'Journal entry created')
      ).toBe(true)
    })
  })
})
