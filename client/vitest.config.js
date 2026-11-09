import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Match @vitejs/plugin-react's automatic JSX runtime so component tests
  // don't need an explicit React import (esbuild's default is classic).
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      provider: 'v8',
      // lib + stores + the UI layer. Pages/components were previously
      // excluded, so the 146 green tests never measured the largest,
      // highest-risk code (POS, Inventory, Layout). Report-only: no
      // thresholds are set, so widening this cannot fail a gate.
      include: ['src/lib/**', 'src/stores/**', 'src/pages/**', 'src/components/**'],
      exclude: ['src/__tests__/**'],
    },
  },
})
