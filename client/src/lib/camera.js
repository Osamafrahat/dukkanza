// Camera failure messages for the POS barcode scanner.

/**
 * Timing knobs, exported so tests can shrink them instead of waiting out
 * real timeouts (RTL's waitFor cannot drive vitest's fake timers — it
 * looks for a `jest` global that does not exist here).
 */
export const cameraTiming = {
  /** How long the <video> may take to produce decodable frames. */
  videoReadyTimeoutMs: 5000,
}

/**
 * Wait until the <video> actually has decodable frames (readyState and real
 * dimensions). zxing paints frames onto a canvas; starting before that
 * throws InvalidStateError, which kills its decode loop permanently —
 * another way to end up with a live preview that never scans.
 *
 * Resolves true when ready, false on timeout.
 */
export function waitForVideoReady(video, timeoutMs = cameraTiming.videoReadyTimeoutMs) {
  return new Promise(resolve => {
    const startedAt = Date.now()
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) return resolve(true)
      if (Date.now() - startedAt >= timeoutMs) return resolve(false)
      setTimeout(check, 100)
    }
    check()
  })
}

/**
 * Which set of unblock instructions to show for a blocked camera.
 *
 * The permission prompt NEVER re-appears after a denial (browser rule), so
 * the user has to be walked through their own browser settings — and those
 * differ per platform. Android Chrome in particular has no camera icon in
 * the address bar, so desktop wording is useless there.
 */
export function cameraPlatform() {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

/** Translation keys with concrete, platform-correct unblock steps. */
export function cameraFixSteps(platform = cameraPlatform()) {
  if (platform === 'android') return ['scanner.fixAndroid1', 'scanner.fixAndroid2']
  if (platform === 'ios') return ['scanner.fixIOS1', 'scanner.fixIOS2']
  return ['scanner.fixDesktop']
}

/**
 * Map a getUserMedia failure to a translation key.
 *
 * `permissionState` is the Permissions API state captured BEFORE the
 * request: a 'denied' the browser already recorded is never re-prompted, so
 * the user must be told where to re-enable the camera (the site-settings
 * control in the address bar) instead of the useless "allow access when
 * prompted" advice — which is exactly the case where they see no prompt at
 * all. Returns a key rather than a pre-baked string so the message follows
 * the active language.
 */
export function cameraErrorMessage(err, permissionState) {
  const name = err?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { key: permissionState === 'denied' ? 'scanner.permissionBlocked' : 'scanner.permissionDenied' }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { key: 'scanner.noCamera' }
  if (name === 'NotReadableError' || name === 'TrackStartError') return { key: 'scanner.cameraInUse' }
  // getUserMedia is absent outside a secure context (plain HTTP).
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices?.getUserMedia) return { key: 'scanner.insecure' }
  return { key: 'scanner.cameraError' }
}
