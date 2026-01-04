/**
 * Unit tests for formatting utilities
 */
import { describe, it, expect } from 'vitest'
import {
  formatNumber,
  formatPriceChange,
  formatPercentChange,
  formatTime,
  formatDateTime,
} from './formatting.js'

describe('formatNumber', () => {
  describe('basic formatting', () => {
    it('formats small numbers with no decimals by default', () => {
      expect(formatNumber(42)).toBe('42')
      expect(formatNumber(999)).toBe('999')
    })

    it('formats numbers with specified decimals', () => {
      expect(formatNumber(42.567, 2)).toBe('42.57')
      expect(formatNumber(100, 2)).toBe('100.00')
    })

    it('formats zero correctly', () => {
      expect(formatNumber(0)).toBe('0')
      expect(formatNumber(0, 2)).toBe('0.00')
    })
  })

  describe('K suffix (thousands)', () => {
    it('formats thousands with K suffix', () => {
      expect(formatNumber(1000)).toBe('1.0K')
      expect(formatNumber(1500)).toBe('1.5K')
      expect(formatNumber(50000)).toBe('50.0K')
      expect(formatNumber(999999)).toBe('1000.0K')
    })

    it('formats negative thousands with K suffix', () => {
      expect(formatNumber(-1000)).toBe('-1.0K')
      expect(formatNumber(-5500)).toBe('-5.5K')
    })
  })

  describe('M suffix (millions)', () => {
    it('formats millions with M suffix', () => {
      expect(formatNumber(1000000)).toBe('1.0M')
      expect(formatNumber(1500000)).toBe('1.5M')
      expect(formatNumber(50000000)).toBe('50.0M')
    })

    it('formats negative millions with M suffix', () => {
      expect(formatNumber(-1000000)).toBe('-1.0M')
      expect(formatNumber(-2500000)).toBe('-2.5M')
    })
  })

  describe('null/undefined handling', () => {
    it('returns "--" for undefined', () => {
      expect(formatNumber(undefined)).toBe('--')
    })

    it('returns "--" for null', () => {
      expect(formatNumber(null)).toBe('--')
    })
  })

  describe('edge cases', () => {
    it('handles negative numbers below 1000', () => {
      expect(formatNumber(-500)).toBe('-500')
      expect(formatNumber(-42.5, 1)).toBe('-42.5')
    })

    it('handles very small numbers', () => {
      expect(formatNumber(0.001, 3)).toBe('0.001')
      expect(formatNumber(-0.001, 3)).toBe('-0.001')
    })
  })
})

describe('formatPriceChange', () => {
  describe('positive changes', () => {
    it('adds + sign for positive values', () => {
      expect(formatPriceChange(5)).toBe('+5.00')
      expect(formatPriceChange(0.5)).toBe('+0.50')
      expect(formatPriceChange(100.123, 2)).toBe('+100.12')
    })

    it('respects decimal places parameter', () => {
      expect(formatPriceChange(5.5555, 0)).toBe('+6')
      expect(formatPriceChange(5.5555, 1)).toBe('+5.6')
      expect(formatPriceChange(5.5555, 3)).toBe('+5.556')
    })
  })

  describe('negative changes', () => {
    it('adds - sign for negative values', () => {
      expect(formatPriceChange(-5)).toBe('-5.00')
      expect(formatPriceChange(-0.5)).toBe('-0.50')
      expect(formatPriceChange(-100.123, 2)).toBe('-100.12')
    })
  })

  describe('zero handling', () => {
    it('treats zero as positive', () => {
      expect(formatPriceChange(0)).toBe('+0.00')
      expect(formatPriceChange(0, 0)).toBe('+0')
    })

    it('treats -0 as positive', () => {
      expect(formatPriceChange(-0)).toBe('+0.00')
    })
  })

  describe('edge cases', () => {
    it('handles very small values', () => {
      expect(formatPriceChange(0.001, 3)).toBe('+0.001')
      expect(formatPriceChange(-0.001, 3)).toBe('-0.001')
    })

    it('handles large values', () => {
      expect(formatPriceChange(1000000, 2)).toBe('+1000000.00')
      expect(formatPriceChange(-1000000, 2)).toBe('-1000000.00')
    })
  })
})

describe('formatPercentChange', () => {
  describe('positive percentages', () => {
    it('adds + sign and % suffix for positive values', () => {
      expect(formatPercentChange(5)).toBe('+5.00%')
      expect(formatPercentChange(0.5)).toBe('+0.50%')
      expect(formatPercentChange(100.123, 2)).toBe('+100.12%')
    })

    it('respects decimal places parameter', () => {
      expect(formatPercentChange(5.5555, 0)).toBe('+6%')
      expect(formatPercentChange(5.5555, 1)).toBe('+5.6%')
      expect(formatPercentChange(5.5555, 3)).toBe('+5.556%')
    })
  })

  describe('negative percentages', () => {
    it('adds - sign and % suffix for negative values', () => {
      expect(formatPercentChange(-5)).toBe('-5.00%')
      expect(formatPercentChange(-0.5)).toBe('-0.50%')
      expect(formatPercentChange(-100.123, 2)).toBe('-100.12%')
    })
  })

  describe('zero handling', () => {
    it('treats zero as positive', () => {
      expect(formatPercentChange(0)).toBe('+0.00%')
      expect(formatPercentChange(0, 0)).toBe('+0%')
    })
  })

  describe('edge cases', () => {
    it('handles very small percentages', () => {
      expect(formatPercentChange(0.001, 3)).toBe('+0.001%')
      expect(formatPercentChange(-0.001, 3)).toBe('-0.001%')
    })

    it('handles large percentages', () => {
      expect(formatPercentChange(1000, 1)).toBe('+1000.0%')
      expect(formatPercentChange(-1000, 1)).toBe('-1000.0%')
    })
  })
})

describe('formatTime', () => {
  it('formats timestamp to locale time string', () => {
    const timestamp = new Date('2024-01-15T14:30:00Z').getTime()
    const result = formatTime(timestamp)
    // Locale-dependent, so just verify it returns a string
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles Date objects', () => {
    const date = new Date('2024-01-15T10:00:00')
    const result = formatTime(date.getTime())
    expect(typeof result).toBe('string')
  })

  it('handles ISO date strings', () => {
    const result = formatTime('2024-01-15T14:30:00Z')
    expect(typeof result).toBe('string')
  })

  it('handles midnight', () => {
    const midnight = new Date('2024-01-15T00:00:00').getTime()
    const result = formatTime(midnight)
    expect(typeof result).toBe('string')
  })
})

describe('formatDateTime', () => {
  it('formats timestamp to locale date/time string', () => {
    const timestamp = new Date('2024-01-15T14:30:00Z').getTime()
    const result = formatDateTime(timestamp)
    // Locale-dependent, so just verify it returns a string
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles Date objects', () => {
    const date = new Date('2024-01-15T10:00:00')
    const result = formatDateTime(date.getTime())
    expect(typeof result).toBe('string')
  })

  it('handles ISO date strings', () => {
    const result = formatDateTime('2024-01-15T14:30:00Z')
    expect(typeof result).toBe('string')
  })

  it('includes both date and time components', () => {
    const timestamp = new Date('2024-06-15T14:30:00').getTime()
    const result = formatDateTime(timestamp)
    // Should be longer than just time (typically includes date components)
    expect(result.length).toBeGreaterThan(8)
  })
})
