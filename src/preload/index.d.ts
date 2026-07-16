import type { CartelsiaApi } from './index'

declare global {
  interface Window {
    cartelsia: CartelsiaApi & { env?: { e2e: boolean } }
  }
}

export {}
