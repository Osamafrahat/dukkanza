import { X, Camera, Keyboard, Check, Loader2, RefreshCw } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../stores/appStore'
import { cameraErrorMessage } from '../../lib/camera'

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
  const animFrameRef = useRef(null)
  const lastScanRef = useRef('')
  const lastScanTimeRef = useRef(0)
  const detectorRef = useRef(null)

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

  const scanFrame = useCallback(() => {
    if (!videoRef.current || !detectorRef.current || videoRef.current.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(scanFrame)
      return
    }

    detectorRef.current.detectFromVideo(videoRef.current).then(barcodes => {
      if (barcodes.length > 0) {
        const barcode = barcodes[0].rawValue
        if (barcode) {
          handleScanResult(barcode)
        }
      }
    }).catch(() => {})

    animFrameRef.current = requestAnimationFrame(scanFrame)
  }, [handleScanResult])

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
      // Check if BarcodeDetector is natively supported, otherwise use @zxing/library
      let useNative = 'BarcodeDetector' in window

      if (useNative) {
        // Try native BarcodeDetector
        try {
          const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
          detectorRef.current = { detectFromVideo: (video) => detector.detect(video) }
        } catch (e) {
          useNative = false
        }
      }

      if (!useNative) {
        const { BrowserMultiFormatReader } = await import('@zxing/library')
        const reader = new BrowserMultiFormatReader()
        detectorRef.current = {
          detectFromVideo: async (video) => {
            try {
              const result = await reader.decodeOnceFromVideoDevice(undefined, video)
              return result ? [{ rawValue: result.getText() }] : []
            } catch (e) {
              return []
            }
          }
        }
      }

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

      // Wait for DOM
      await new Promise(resolve => setTimeout(resolve, 100))

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsScanning(true)
        // Start scanning loop
        animFrameRef.current = requestAnimationFrame(scanFrame)
      }
    } catch (err) {
      console.error('Camera error:', err)
      setIsScanning(false)
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
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    detectorRef.current = null
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
<div className={`bg-surface rounded-2xl w-full max-w-md mx-4 shadow-2xl transition-all ${flash ?'ring-4 ring-green-400':''}`}>
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
