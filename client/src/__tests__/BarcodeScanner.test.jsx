import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'

import { cameraErrorMessage } from '../lib/camera'
import BarcodeScanner from '../components/pos/BarcodeScanner'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // navigator props are defined per-test; drop them so the next test sees
  // the pristine jsdom navigator (no mediaDevices, no permissions).
  delete window.navigator.mediaDevices
  delete window.navigator.permissions
  delete window.BarcodeDetector
})

beforeEach(() => {
  // Avoid pulling @zxing/library in: the native-detector path is enough to
  // exercise startCamera, and it keeps these tests fast and deterministic.
  window.BarcodeDetector = class {
    detect() { return Promise.resolve([]) }
  }
  // jsdom has no real media element playback.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

const notAllowed = () => Object.assign(new Error('denied'), { name: 'NotAllowedError' })
const namedError = (name) => Object.assign(new Error(name), { name })

const fakeStream = () => ({ getTracks: () => [{ stop: vi.fn() }] })

/** Install navigator.mediaDevices + navigator.permissions for one test. */
const stubCamera = ({ getUserMedia, state = 'prompt' }) => {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window.navigator, 'permissions', {
    value: { query: vi.fn().mockResolvedValue({ state }) },
    configurable: true,
    writable: true,
  })
}

const renderScanner = () => render(<BarcodeScanner onScan={vi.fn()} onClose={vi.fn()} />)

const clickCameraTab = (utils) => {
  const tab = utils.getByRole('button', { name: /^Camera$/ })
  fireEvent.click(tab)
  return tab
}

describe('cameraErrorMessage', () => {
  it('distinguishes a BLOCKED site (already denied, never re-prompts) from a dismissed prompt', () => {
    // The reported bug: Chrome keeps a recorded denial and shows no prompt,
    // so "allow when prompted" advice is useless — the user must be pointed
    // at the address-bar site settings instead.
    expect(cameraErrorMessage(notAllowed(), 'denied')).toEqual({ key: 'scanner.permissionBlocked' })
    expect(cameraErrorMessage(notAllowed(), 'prompt')).toEqual({ key: 'scanner.permissionDenied' })
    expect(cameraErrorMessage(notAllowed(), 'granted')).toEqual({ key: 'scanner.permissionDenied' })
  })

  it('maps device failures to their own messages', () => {
    expect(cameraErrorMessage(namedError('NotFoundError'), 'prompt')).toEqual({ key: 'scanner.noCamera' })
    expect(cameraErrorMessage(namedError('NotReadableError'), 'prompt')).toEqual({ key: 'scanner.cameraInUse' })
  })

  it('reports a missing getUserMedia as the insecure-context case', () => {
    // jsdom has no mediaDevices, mirroring plain HTTP where the API is absent.
    expect(cameraErrorMessage(namedError('TypeError'), 'prompt')).toEqual({ key: 'scanner.insecure' })
  })

  it('falls back to the generic message for anything unrecognised', () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
      writable: true,
    })
    expect(cameraErrorMessage(namedError('NotSupportedError'), 'prompt')).toEqual({ key: 'scanner.cameraError' })
    expect(cameraErrorMessage(undefined, 'prompt')).toEqual({ key: 'scanner.cameraError' })
  })
})

describe('BarcodeScanner camera permission', () => {
  it('shows the BLOCKED-site guidance and a Retry button when permission was already denied', async () => {
    // Permission is 'denied' in the Permissions API AND getUserMedia rejects:
    // this is the remembered-denial case (no prompt ever appears).
    const getUserMedia = vi.fn().mockRejectedValue(notAllowed())
    stubCamera({ getUserMedia, state: 'denied' })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(() =>
      expect(utils.getByText(/Camera is blocked for this site/)).toBeTruthy()
    )
    expect(utils.getByRole('alert')).toBeTruthy()
    // Actionable next step, not just "check your browser settings".
    expect(utils.getByRole('button', { name: /Retry/ })).toBeTruthy()
    // Fell back to manual entry so the user is never stuck on a dead view.
    expect(utils.getByText('Enter barcode manually')).toBeTruthy()
    // The spinner cleared, so the Camera tab is usable again.
    expect(utils.getByRole('button', { name: /^Camera$/ }).disabled).toBe(false)
  })

  it('shows the prompt-denial message when the user just declined the prompt', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(notAllowed())
    stubCamera({ getUserMedia, state: 'prompt' })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(() =>
      expect(utils.getByText(/Allow camera access when prompted/)).toBeTruthy()
    )
    expect(utils.queryByText(/blocked for this site/)).toBe(null)
  })

  it('reports a device with no camera', async () => {
    stubCamera({ getUserMedia: vi.fn().mockRejectedValue(namedError('NotFoundError')) })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(() =>
      expect(utils.getByText('No camera found on this device.')).toBeTruthy()
    )
  })

  it('explains the insecure-context case instead of throwing a TypeError', async () => {
    // Plain HTTP: navigator.mediaDevices is undefined entirely.
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(() =>
      expect(utils.getByText(/secure \(HTTPS\) connection/)).toBeTruthy()
    )
    // No getUserMedia call was even attempted.
    expect(utils.getByText('Enter barcode manually')).toBeTruthy()
  })

  it('retries getUserMedia when Retry is tapped (so unblocking in the address bar works without closing the modal)', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(notAllowed())
    stubCamera({ getUserMedia, state: 'denied' })

    const utils = renderScanner()
    clickCameraTab(utils)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))

    fireEvent.click(utils.getByRole('button', { name: /Retry/ }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    // Still blocked, so the guidance stays up.
    expect(utils.getByText(/Camera is blocked for this site/)).toBeTruthy()
  })

  it('falls back to any camera when the rear-camera constraint is rejected', async () => {
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(namedError('OverconstrainedError'))
      .mockResolvedValueOnce(fakeStream())
    stubCamera({ getUserMedia })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    // First ask preferred the rear camera, second accepted any camera.
    expect(getUserMedia.mock.calls[0][0].video.facingMode).toBe('environment')
    expect(getUserMedia.mock.calls[1][0]).toEqual({ video: true })
    // Scanning actually started.
    await waitFor(() =>
      expect(utils.getByText('Point camera at barcode...')).toBeTruthy()
    )
  })
})
