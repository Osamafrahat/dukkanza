import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'

import { cameraErrorMessage, cameraTiming } from '../lib/camera'
import BarcodeScanner from '../components/pos/BarcodeScanner'

// jsdom's <video> never becomes playable, so waitForVideoReady() would
// always time out. Make videos look ready; the no-picture test overrides
// these back to 0 and afterEach restores them.
const stubReadyVideo = (readyState = 4, videoWidth = 64) => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', { get: () => readyState, configurable: true })
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', { get: () => videoWidth, configurable: true })
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoHeight', { get: () => videoWidth, configurable: true })
}
stubReadyVideo()

// zxing paints the video frame onto a canvas before decoding; jsdom has no
// canvas backend, so hand it a minimal 2D context to chew on.
const ctxStub = {
  drawImage: () => {},
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
  fillRect: () => {},
  clearRect: () => {},
  save: () => {},
  restore: () => {},
}
window.HTMLCanvasElement.prototype.getContext = () => ctxStub

/**
 * Native detector double: the interface is visible but the detection
 * service behind it does not exist — exactly Windows/Linux Chrome, where
 * detect() rejects on every call.
 */
class NativeDetectorDouble {
  static getSupportedFormats() {
    return Promise.resolve({ code_128: true, ean_13: true, ean_8: true, upc_a: true, upc_e: true, code_39: true, qr_code: true })
  }
  detect() {
    return Promise.reject(Object.assign(new Error('Barcode detection service unavailable'), { name: 'DOMException' }))
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cameraTiming.videoReadyTimeoutMs = 5000
  delete window.BarcodeDetector
  delete window.navigator.mediaDevices
  delete window.navigator.permissions
  delete window.navigator.userAgent
  stubReadyVideo()
})

beforeEach(() => {
  vi.clearAllMocks()
  // The component logs real failures; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.BarcodeDetector = NativeDetectorDouble
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
    // Concrete platform steps (jsdom's UA is desktop) — queried as list
    // items because the <ol> itself also contains the step text.
    const steps = utils.getAllByRole('listitem')
    expect(steps).toHaveLength(1)
    expect(steps[0].textContent).toContain('Click the camera icon in the address bar')
    // Fell back to manual entry so the user is never stuck on a dead view.
    expect(utils.getByText('Enter barcode manually')).toBeTruthy()
    // The spinner cleared, so the Camera tab is usable again.
    expect(utils.getByRole('button', { name: /^Camera$/ }).disabled).toBe(false)
  }, 15000)

  it('shows Android-specific unblock steps on a phone', async () => {
    // Android Chrome has NO camera icon in the address bar, so desktop
    // wording would send the user hunting for something that isn't there —
    // this is the reported mobile case.
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      configurable: true,
    })
    const getUserMedia = vi.fn().mockRejectedValue(notAllowed())
    stubCamera({ getUserMedia, state: 'denied' })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(() =>
      expect(utils.getByText(/Camera is blocked for this site/)).toBeTruthy()
    )
    const steps = utils.getAllByRole('listitem')
    expect(steps).toHaveLength(2)
    expect(steps[0].textContent).toContain('Tap the lock icon beside the address bar')
    expect(steps[0].textContent).toContain('Site settings → Camera')
    expect(steps[1].textContent).toContain('Chrome ⋮')
    // Desktop wording must not leak onto a phone.
    expect(steps[0].textContent).not.toContain('Click the camera icon')
    expect(utils.getByRole('button', { name: /Retry/ })).toBeTruthy()
  }, 15000)

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
    await waitFor(
      () => expect(utils.getByText('Point camera at barcode...')).toBeTruthy(),
      { timeout: 5000 }
    )
  }, 15000)
})

describe('BarcodeScanner detection', () => {
  it('acquires the camera EXACTLY once while the decode loop runs', async () => {
    // Regression guard for the "camera sees nothing" bug: the old zxing path
    // called decodeOnceFromVideoDevice() on every animation frame, and that
    // API calls getUserMedia() itself — restarting the camera ~60×/s so
    // decoding never got a stable frame. No BarcodeDetector here, so this
    // exercises the zxing path.
    delete window.BarcodeDetector
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream())
    stubCamera({ getUserMedia })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(
      () => expect(utils.getByText('Point camera at barcode...')).toBeTruthy(),
      { timeout: 5000 }
    )
    // Let zxing's own setTimeout-driven decode loop spin for a while.
    await new Promise(resolve => setTimeout(resolve, 400))

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    // No error surfaced: the loop is alive and decoding.
    expect(utils.queryByRole('alert')).toBe(null)
  }, 15000)

  it('hands over to zxing when the native detector fails at runtime', async () => {
    // Windows/Linux Chrome: BarcodeDetector exists, getSupportedFormats()
    // reports support, but detect() rejects because no detection service
    // exists. The old code swallowed that forever, so scanning did nothing.
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream())
    stubCamera({ getUserMedia })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(
      () => expect(utils.getByText('Point camera at barcode...')).toBeTruthy(),
      { timeout: 5000 }
    )
    // zxing took over without re-acquiring the camera.
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    // The handover succeeded: no error banner.
    expect(utils.queryByRole('alert')).toBe(null)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('switched to zxing'),
      expect.anything()
    )
  }, 15000)

  it('uses zxing when the native detector cannot read code_128', async () => {
    // Our labels print Code 128 (pickBarcodeFormat), so a native detector
    // without it would return [] forever on them.
    window.BarcodeDetector = class {
      static getSupportedFormats() {
        return Promise.resolve({ qr_code: true })
      }
      detect() {
        return Promise.resolve([{ rawValue: 'QR-ONLY' }])
      }
    }
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream())
    stubCamera({ getUserMedia })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(
      () => expect(utils.getByText('Point camera at barcode...')).toBeTruthy(),
      { timeout: 5000 }
    )
    expect(utils.queryByRole('alert')).toBe(null)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  }, 15000)

  it('reports when the camera produces no picture', async () => {
    // readyState/videoWidth stay at 0: the stream never yields frames, so
    // starting a decoder would hang forever with a dead preview. Shrink the
    // ready-wait instead of faking timers — RTL's waitFor cannot drive
    // vitest's fake clock (it looks for a `jest` global).
    cameraTiming.videoReadyTimeoutMs = 50
    stubReadyVideo(0, 0)
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream())
    stubCamera({ getUserMedia })

    const utils = renderScanner()
    clickCameraTab(utils)

    await waitFor(
      () => expect(utils.getByText(/produced no picture/)).toBeTruthy(),
      { timeout: 5000 }
    )
    expect(utils.queryByText('Point camera at barcode...')).toBe(null)
    // The camera was released rather than left running behind an error.
    expect(utils.getByText('Enter barcode manually')).toBeTruthy()
  }, 15000)
})
