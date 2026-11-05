import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// vercel.json is the production config for dukkanza.com — the headers it
// sets are served on EVERY response. A past "security hardening" commit
// shipped Permissions-Policy: camera=(), which disables the POS barcode
// scanner at the browser policy level: no prompt ever appears and the
// user's site-settings Allow cannot override a response header. That bug
// survived three rounds of on-device debugging because it lives in
// infrastructure, not code — so assert it can never come back.
const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))

const headerValue = (name) => {
  const found = (config.headers || [])
    .flatMap(group => group.headers || [])
    .find(h => h.key.toLowerCase() === name.toLowerCase())
  return found ? found.value : null
}

describe('vercel.json Permissions-Policy', () => {
  const policy = headerValue('Permissions-Policy')

  it('is present (the header must keep protecting unused features)', () => {
    expect(policy).toBeTruthy()
  })

  it('never denies camera — the POS barcode scanner needs it', () => {
    // camera=() blocks getUserMedia with NotAllowedError BEFORE any prompt,
    // so the scanner shows a permanent "blocked" banner no matter what the
    // user does in browser settings.
    expect(policy).not.toMatch(/(^|[,\s])camera=\s*\(\s*\)/)
    // Camera must be allowed for the app's own origin.
    expect(policy).toMatch(/camera=/)
  })

  it('never denies geolocation — attendance check-in and store location use it', () => {
    expect(policy).not.toMatch(/(^|[,\s])geolocation=\s*\(\s*\)/)
  })

  it('still denies microphone and payment (unused, attack surface stays closed)', () => {
    expect(policy).toMatch(/microphone=\s*\(\s*\)/)
    expect(policy).toMatch(/payment=\s*\(\s*\)/)
  })
})
