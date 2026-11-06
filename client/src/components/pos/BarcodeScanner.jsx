import { X, Camera, Keyboard, Check, Loader2, RefreshCw } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../stores/appStore'
import { cameraErrorMessage, waitForVideoReady, cameraFixSteps } from '../../lib/camera'

export default function BarcodeScanner({ onScan, onClose }) {
  const { t } = useAppStore()
  const [mode, setMode] = useState('manual')
  const [manualInput, setManualInput] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [cameraLoading, setCameraLoading] = useState(false)
  const [scanCount, setScanCount] = useState(0)
  const [lastScanned, setLastScanned] = useState('')
  const [lastProductName, setLastProductName] = useState('')
  const [flash, setFlash] = useState(false)
  // { key, params? } — a translation key, not a pre-baked English string,
  // so the message follows the active language.
  const [cameraError, setCameraError] = useState(null)
  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const lastScanRef = useRef('')
  const lastScanTimeRef = useRef(0)
  const detectorRef = useRef(null)
  // Guards the native→zxing handover against firing twice.
  const swappingRef = useRef(false)

  useEffect(() => {
    if (mode === 'manual') {
      inputRef.current?.focus()
    }
  }, [mode])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  const handleScanResult = useCallback(async (barcode) => {
    const now = Date.now()
    if (barcode === lastScanRef.current && now - lastScanTimeRef.current < 2000) return
    lastScanRef.current = barcode
    lastScanTimeRef.current = now

    setLastScanned(barcode)
    setLastProductName('')
    setScanCount(prev => prev + 1)
    setFlash(true)
    setTimeout(() => setFlash(false), 300)
    const name = await onScan(barcode)
    if (name) setLastProductName(name)
  }, [onScan])

  const handleManualSubmit = (e) => {
    e.preventDefault()
    if (manualInput.trim()) {
      handleScanResult(manualInput.trim())
      setManualInput('')
      inputRef.current?.focus()
    }
  }

  // The detection loops outlive the render that created them (rAF, or
  // zxing's own timer), so they must call the CURRENT handler: onScan is a
  // fresh function on every POSPage render and a stale one would scan
  // against outdated cart state.
  const handleScanResultRef = useRef(handleScanResult)
  useEffect(() => {
    handleScanResultRef.current = handleScanResult
  }, [handleScanResult])

  // --- Detector factories -------------------------------------------------
  // Both shapes are { kind, start(video), stop() } and both deliver results
  // through handleScanResultRef. stopCamera() tears them down via stop().

  const makeNativeDetector = (detector, onUnavailable) => {
    let rafId = null
    let running = false
    return {
      kind: 'native',
      start(video) {
        running = true
        // First attempt runs immediately — no frame of grace — so a broken
        // detection service is handed to zxing right away instead of after
        // a rAF. Every later attempt is throttled to one per frame.
        const tick = async () => {
          if (!running) return
          try {
            const codes = await detector.detect(video)
            const code = codes && codes[0] && codes[0].rawValue
            if (code && running) handleScanResultRef.current(code)
          } catch (err) {
            // Windows/Linux Chrome exposes the BarcodeDetector interface
            // but ships no detection service, so detect() rejects on every
            // frame. The old `.catch(() => {})` swallowed that forever and
            // scanning silently did nothing — hand over to zxing instead.
            if (running) onUnavailable(err)
            return
          }
          if (running) rafId = requestAnimationFrame(tick)
        }
        tick()
      },
      stop() {
        running = false
        if (rafId) cancelAnimationFrame(rafId)
        rafId = null
      },
    }
  }

  const makeZxingDetector = async () => {
    const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import('@zxing/library')
    // Tell zxing which symbologies exist BEFORE it picks its readers. With
    // no POSSIBLE_FORMATS hint, MultiFormatReader.setHints(null) instantiates
    // every reader it knows — QR, MicroQR, DataMatrix, Aztec, PDF417,
    // MaxiCode plus all the 1-D formats — and runs EVERY one of them against
    // every frame. zxing's own docs say these hints give a "large speed
    // increase" for continuous scanning. Same list the native detector asks
    // for: Code 128 for our labels, EAN/UPC for retail goods, Code 39, QR.
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_39,
      BarcodeFormat.QR_CODE,
    ])
    // 2nd arg = pause after a SUCCESSFUL decode. zxing defaults to 500ms,
    // which is dead air after every scan while the cashier moves to the
    // next item; misses still retry at the 100ms set below.
    const reader = new BrowserMultiFormatReader(hints, 150)
    // Misses retry at 0ms by default — a hot loop that pegs a core while
    // nothing is in frame. 100ms is plenty for a POS scan.
    reader.timeBetweenDecodingAttempts = 100
    return {
      kind: 'zxing',
      start(video) {
        // Decode from the stream we ALREADY own. The old code called
        // decodeOnceFromVideoDevice() on every animation frame, and that
        // API calls getUserMedia() itself (reset → new constraints → brand
        // new stream), restarting the camera ~60×/s so decoding never got a
        // stable frame. This variant reads the existing element only.
        reader.decodeContinuously(video, (result) => {
          const code = result && typeof result.getText === 'function' ? result.getText() : null
          if (code) handleScanResultRef.current(code)
        })
      },
      stop() {
        // reset() → stopContinuousDecode() ends the loop; this.stream stays
        // undefined because we own the stream, so our tracks survive.
        try { reader.reset() } catch { /* already stopped */ }
      },
    }
  }

  // Native path is only trusted when the browser both exposes the API and
  // reports our primary symbology: Chrome has made BarcodeDetector visible
  // on every platform since v83 while supporting it on Android/ChromeOS/
  // macOS only, so mere visibility proves nothing.
  const createDetector = async (onNativeUnavailable) => {
    if ('BarcodeDetector' in window) {
      try {
        const wanted = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'qr_code']
        let formats = wanted
        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
          const supported = await BarcodeDetector.getSupportedFormats()
          formats = wanted.filter(f => supported && supported[f])
        }
        // Labels print Code 128 (see pickBarcodeFormat), so a native
        // detector without it would return [] forever — use zxing instead.
        if (formats.includes('code_128')) {
          return makeNativeDetector(new BarcodeDetector({ formats }), onNativeUnavailable)
        }
        console.warn('BarcodeScanner: native detector lacks code_128, using zxing')
      } catch (err) {
        // getSupportedFormats() rejects where no detection service exists
        // (Windows/Linux Chrome), and construction can fail too.
        console.warn('BarcodeScanner: native detector unavailable, using zxing:', err)
      }
    }
    return makeZxingDetector()
  }

  // Called when the native detector fails at runtime: swap to zxing without
  // touching the camera stream (the preview keeps running throughout).
  const swapToZxing = async (reason) => {
    const video = videoRef.current
    if (!video || swappingRef.current || detectorRef.current?.kind === 'zxing') return
    swappingRef.current = true
    try {
      detectorRef.current?.stop()
      const fallback = await makeZxingDetector()
      detectorRef.current = fallback
      fallback.start(video)
      console.warn('BarcodeScanner: native detector failed at runtime, switched to zxing:', reason)
    } catch (err) {
      console.error('BarcodeScanner: zxing fallback failed:', err)
      stopCamera()
      setMode('manual')
      setCameraError({ key: 'scanner.cameraError' })
    } finally {
      swappingRef.current = false
    }
  }

  const startCamera = async () => {
    setCameraLoading(true)
    setCameraError(null)
    setMode('camera')

    // getUserMedia only exists in a secure context (HTTPS or localhost).
    // On plain HTTP it is undefined and the call below would throw a bare
    // TypeError — say what is actually wrong instead.
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError({ key: 'scanner.insecure' })
      setMode('manual')
      setCameraLoading(false)
      return
    }

    // Probe the CURRENT permission state before asking for the stream. A
    // denial the browser has already recorded is never re-prompted, so we
    // must be able to tell "you blocked this site, here is how to undo it"
    // apart from "you just dismissed the prompt".
    let permissionState = 'prompt'
    try {
      permissionState = (await navigator.permissions?.query({ name: 'camera' }))?.state || 'prompt'
    } catch {
      /* Permissions API unsupported (older Safari/Firefox) — fall back to prompting */
    }

    try {
      // Get camera stream. Prefer the rear camera, but retry with any
      // camera if the device rejects that constraint (desktops/webcams
      // often have no 'environment' camera and would otherwise fail).
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        })
      } catch (err) {
        if (err.name === 'OverconstrainedError') {
          stream = await navigator.mediaDevices.getUserMedia({ video: true })
        } else {
          throw err
        }
      }
      streamRef.current = stream

      // Build the detector once, against the stream we now own.
      const detector = await createDetector(swapToZxing)
      detectorRef.current = detector

      // Wait for DOM
      await new Promise(resolve => setTimeout(resolve, 100))

      const video = videoRef.current
      if (!video) throw new Error('scanner video element not mounted')

      video.srcObject = stream
      await video.play()

      // zxing paints frames to a canvas; starting before the video has
      // frames and dimensions throws and kills its loop for good.
      if (!(await waitForVideoReady(video))) {
        stopCamera()
        setMode('manual')
        setCameraError({ key: 'scanner.videoNotReady' })
        return
      }

      detector.start(video)
      setIsScanning(true)
    } catch (err) {
      console.error('Camera error:', err)
      // Release the camera on every failure path — a late failure could
      // otherwise leave the preview stream running with no scanner.
      stopCamera()
      setMode('manual')
      setCameraError(cameraErrorMessage(err, permissionState))
    } finally {
      // Always clear the spinner. Previously this only ran on success, so a
      // failure with no <video> mounted left 'Starting camera...' stuck and
      // the Camera tab permanently disabled (no retry possible).
      setCameraLoading(false)
    }
  }

  const stopCamera = () => {
    // Stop the ACTIVE detector first: for native that cancels its rAF, for
    // zxing it ends the decode loop. Nulling without stopping would leave
    // zxing's timer running after the modal closes.
    try {
      detectorRef.current?.stop()
    } catch (err) {
      console.warn('BarcodeScanner: detector stop failed:', err)
    }
    detectorRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsScanning(false)
  }

  const switchToManual = () => {
    stopCamera()
    setMode('manual')
    setCameraError(null)
  }

  const switchToCamera = () => {
    stopCamera()
    startCamera()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className={`bg-surface rounded-2xl w-full max-w-md mx-4 shadow-2xl transition-all max-h-[90vh] overflow-y-auto ${flash ?'ring-4 ring-green-400':''}`}>
        {/* Header */}
<div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">{t('scanner.title')}</h2>
            {scanCount > 0 && (
<span className="px-2.5 py-0.5 bg-accent-soft text-accent-soft-foreground rounded-full text-sm font-bold">
                {scanCount} {scanCount === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>
          <button
            onClick={() => {
              stopCamera()
              onClose()
            }}
className="p-2 rounded-lg bg-surface-hover"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Last Scanned Feedback */}
        {lastScanned && (
          <div className="px-4 pt-3">
<div className="flex items-center gap-2 px-3 py-2 bg-success-soft rounded-lg">
<Check className="w-4 h-4 text-success shrink-0"/>
              <div className="min-w-0">
                {lastProductName && (
<p className="text-sm font-semibold text-success truncate">{lastProductName}</p>
                )}
<span className="text-xs text-success">
                  {lastScanned}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Mode Toggle */}
        <div className="p-4">
<div className="flex gap-2 p-1 bg-surface-tertiary rounded-lg">
            <button
              onClick={switchToManual}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md transition-colors ${
                mode === 'manual'
?'bg-surface shadow-sm'
:'text-muted'
              }`}
            >
              <Keyboard className="w-4 h-4" />
              {t('scanner.manual')}
            </button>
            <button
              onClick={switchToCamera}
              disabled={cameraLoading}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md transition-colors ${
                mode === 'camera'
?'bg-surface shadow-sm'
:'text-muted'
              }`}
            >
              {cameraLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {t('scanner.camera')}
            </button>
          </div>
        </div>

        {/* Scanner Content */}
        <div className="p-4">
          {/* Camera failure — rendered OUTSIDE the mode branches so it is
              visible in camera mode too, with a one-tap retry (the fix for
              a remembered denial: unblock in the address bar, then retry
              without closing the modal). */}
          {cameraError && (
            <div role="alert" className="mb-4 p-3 bg-danger-soft rounded-lg space-y-3">
              <p className="text-sm text-danger">{t(cameraError.key)}</p>
              {/* A denial is never re-prompted, so the user must be walked
                  through their own browser settings — steps differ per
                  platform (Android Chrome has no camera icon in the bar). */}
              {cameraError.key === 'scanner.permissionBlocked' && (
                <ol className="list-decimal ps-4 space-y-1.5 text-xs text-danger">
                  {cameraFixSteps().map(key => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ol>
              )}
              <button
                onClick={startCamera}
                disabled={cameraLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-surface text-foreground rounded-lg font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cameraLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {t('scanner.retry')}
              </button>
            </div>
          )}
          {mode === 'manual' ? (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
<label className="block text-sm font-medium text-foreground mb-2">
                  {t('scanner.enterBarcode')}
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder={t('scanner.barcodePlaceholder')}
className="w-full px-4 py-3 text-lg rounded-lg border border-border bg-surface ring-focus focus:border-transparent"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={!manualInput.trim()}
className="w-full py-3 bg-accent text-white rounded-lg font-semibold hover:bg-primary-700 bg-surface-tertiary disabled:cursor-not-allowed"
              >
                {t('scanner.add')} {manualInput.trim() ? `(${manualInput.trim()})` : ''}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
<div className="relative w-full h-64 bg-surface-secondary rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                {/* Scan overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
<div className="w-56 h-56 border-2 border-white/50 rounded-lg">
<div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-accent rounded-tl-lg"/>
<div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-accent rounded-tr-lg"/>
<div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-accent rounded-bl-lg"/>
<div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-accent rounded-br-lg"/>
<div className="absolute top-1/2 left-2 right-2 h-0.5 bg-accent animate-pulse"/>
                  </div>
                </div>
              </div>
              {cameraLoading && (
<div className="flex items-center justify-center gap-2 text-muted">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <p className="text-sm">{t('scanner.startingCamera')}</p>
                </div>
              )}
              {isScanning && (
<div className="text-center text-muted">
                  <p className="animate-pulse">{t('scanner.pointCamera')}</p>
                  <p className="text-xs mt-1">{t('scanner.continuousMode')}</p>
                </div>
              )}
              <button
                onClick={switchToManual}
className="w-full py-3 bg-surface-tertiary text-foreground rounded-lg font-medium bg-surface-hover"
              >
                {t('scanner.cancelCamera')}
              </button>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="px-4 pb-4">
<div className="p-3 bg-accent-soft rounded-lg">
<p className="text-sm text-accent">
              <strong>{t('scanner.tip')}</strong> {t('scanner.continuousTip')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
