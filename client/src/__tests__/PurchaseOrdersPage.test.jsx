import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

// A PO deposit is paid the moment the order is created: the form field must
// reach the server as deposit_amount/deposit_method, it may never exceed
// the order total, and the client-side check mirrors the server's so the
// user is not bounced off a 400 after clicking Create.
vi.mock('../lib/api', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ data })
  return {
    settingsApi: { get: ok({}) },
    purchaseOrdersApi: {
      getAll: ok([]),
      getStats: ok({}),
      create: vi.fn(),
      getById: ok({ data: {} }),
      update: vi.fn(),
      receive: vi.fn(),
      delete: vi.fn(),
    },
    suppliersApi: { getAll: ok({ data: [] }) },
    productsApi: { getAll: ok({ data: [] }) },
    emailApi: { sendPO: vi.fn() },
    // ok(X) already wraps in { data: X } — branchStore reads res.data.data.
    branchesApi: { getAll: ok({ data: [] }) },
  }
})

// branchStore clears the offline product cache when branches reload.
vi.mock('../lib/offlineDB', () => ({ clearCachedProducts: vi.fn() }))

import PurchaseOrdersPage from '../pages/PurchaseOrdersPage'
import { purchaseOrdersApi, suppliersApi, productsApi } from '../lib/api'
import { useAppStore } from '../stores/appStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [], language: 'en' })
  suppliersApi.getAll.mockResolvedValue({ data: { data: [{ id: 1, name: 'Acme' }] } })
  // price: 50 is auto-copied into unit_price by handleProductSelect, so the
  // order total is qty x 50.
  productsApi.getAll.mockResolvedValue({ data: { data: [{ id: 7, name: 'Widget', price: 50, cost_price: 0 }] } })
  purchaseOrdersApi.create.mockResolvedValue({ data: { id: 15, deposit: null } })
})

function openSelect(triggerText) {
  const trigger = screen.getAllByRole('combobox').find((el) => el.textContent.includes(triggerText))
  expect(trigger).toBeTruthy()
  fireEvent.click(trigger)
}

function pickOption(label) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

// Fill the create form far enough to pass validation: supplier + one item.
async function fillOrder({ qty = '10' } = {}) {
  const utils = render(<PurchaseOrdersPage />)
  // t('createPO') resolves to "Create PO" — the "Create Purchase Order"
  // string is only a fallback that never fires once translations load.
  fireEvent.click(await screen.findByRole('button', { name: 'Create PO' }))

  openSelect('Select supplier...')
  pickOption('Acme')

  openSelect('Product...')
  pickOption('Widget')

  fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: qty } })
  return utils
}

describe('PurchaseOrdersPage — deposit', () => {
  it('offers a deposit amount + method on the create form', async () => {
    await fillOrder()

    const amount = screen.getByPlaceholderText('0 (optional)')
    const method = screen.getByDisplayValue('Cash')
    expect(amount).toBeTruthy()
    expect(method).toBeTruthy()
    // The method select sits idle until there is something to pay.
    expect(method.disabled).toBe(true)
  })

  it('sends the deposit in the create payload', async () => {
    const { container } = await fillOrder()

    fireEvent.change(screen.getByPlaceholderText('0 (optional)'), { target: { value: '200' } })
    // Now that money is involved the method select becomes usable.
    const method = screen.getByDisplayValue('Cash')
    expect(method.disabled).toBe(false)
    fireEvent.change(container.querySelector('select'), { target: { value: 'bank_transfer' } })

    // The helper copy explains what the deposit actually does.
    expect(screen.getByText(/recorded as a supplier advance/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(purchaseOrdersApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          supplier_id: '1',
          deposit_amount: 200,
          deposit_method: 'bank_transfer',
          items: [expect.objectContaining({ product_id: '7', quantity: 10, unit_price: 50 })],
        })
      )
    )
  })

  it('omits the deposit entirely when the field is left empty', async () => {
    await fillOrder()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(purchaseOrdersApi.create).toHaveBeenCalledTimes(1))
    const payload = purchaseOrdersApi.create.mock.calls[0][0]
    expect(payload).not.toHaveProperty('deposit_amount')
    expect(payload).not.toHaveProperty('deposit_method')
  })

  it('refuses a deposit larger than the order total before calling the API', async () => {
    await fillOrder() // 10 x 50 = 500

    fireEvent.change(screen.getByPlaceholderText('0 (optional)'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((t) => t.type === 'error' && t.message === 'Deposit cannot exceed the order total')).toBe(true)
    })
    expect(purchaseOrdersApi.create).not.toHaveBeenCalled()
  })

  it('refuses a negative deposit', async () => {
    const { container } = await fillOrder()

    fireEvent.change(screen.getByPlaceholderText('0 (optional)'), { target: { value: '-5' } })
    // The input carries min="0", so the browser's own constraint validation
    // swallows the Create click before onSubmit ever runs. Dispatch submit
    // directly to exercise the guard itself (programmatic callers reach it).
    fireEvent.submit(container.querySelector('form'))

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts
      expect(toasts.some((t) => t.type === 'error' && t.message === 'Invalid deposit amount')).toBe(true)
    })
    expect(purchaseOrdersApi.create).not.toHaveBeenCalled()
  })
})
