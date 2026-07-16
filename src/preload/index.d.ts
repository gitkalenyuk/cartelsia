import type { CartelsiaApi } from './index'

declare global {
  interface Window {
    cartelsia: CartelsiaApi
  }
}

export {}
