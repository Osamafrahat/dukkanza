// Camera failure messages for the POS barcode scanner.

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
