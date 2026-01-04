/**
 * Vitest global test setup
 */

// Mock localStorage for browser-like environment
const localStorageMock = {
  store: {},
  getItem(key) {
    return this.store[key] || null
  },
  setItem(key, value) {
    this.store[key] = String(value)
  },
  removeItem(key) {
    delete this.store[key]
  },
  clear() {
    this.store = {}
  },
}

global.localStorage = localStorageMock

// Mock fetch for API calls
global.fetch = vi.fn()

// Reset mocks before each test
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})
