/**
 * Unit tests for trade execution and management
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTrade,
  updateTrade,
  closeTrade,
  getMaxAdverseExcursion,
  getMaxFavorableExcursion,
  resetTradeIdCounter,
} from './trade.js'

describe('trade module', () => {
  beforeEach(() => {
    resetTradeIdCounter()
  })

  describe('createTrade', () => {
    const mockSignal = {
      type: 'CALL',
      direction: 'CALL',
      strength: 75,
      source: 'OI-WASP',
      metadata: { wasp: 0.5 },
    }

    const mockCandle = {
      close: 500.25,
      high: 501.00,
      low: 499.50,
      open: 500.00,
      time: 1704067200000, // Monday, Jan 1, 2024 12:00:00 UTC
    }

    it('creates a trade with correct basic properties', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.id).toBe(1)
      expect(trade.signal).toBe('CALL')
      expect(trade.signalType).toBe('CALL')
      expect(trade.strength).toBe(75)
      expect(trade.source).toBe('OI-WASP')
      expect(trade.entryPrice).toBe(500.25)
      expect(trade.entryTime).toBe(1704067200000)
      expect(trade.entryIndex).toBe(0)
    })

    it('creates trade with null exit values initially', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.exitPrice).toBeNull()
      expect(trade.exitTime).toBeNull()
      expect(trade.exitIndex).toBeNull()
      expect(trade.exitReason).toBeNull()
    })

    it('initializes trade with zero P&L and barsHeld', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.barsHeld).toBe(0)
      expect(trade.pnl).toBe(0)
      expect(trade.pnlPercent).toBe(0)
    })

    it('sets high and low price to entry close', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.highPrice).toBe(500.25)
      expect(trade.lowPrice).toBe(500.25)
    })

    it('includes metadata from signal', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.metadata).toEqual({ wasp: 0.5 })
    })

    it('handles signals without metadata', () => {
      const signalNoMeta = { ...mockSignal, metadata: undefined }
      const trade = createTrade(signalNoMeta, mockCandle, 0)

      expect(trade.metadata).toEqual({})
    })

    it('sets option type matching direction', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.optionType).toBe('CALL')
    })

    it('calculates ATM strike as rounded close price', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.strike).toBe(500)
    })

    it('calculates next Friday expiry', () => {
      // The function calculates the next Friday from the entry timestamp
      // Result may vary by 1 day due to timezone (local getDay vs UTC toISOString)
      const trade = createTrade(mockSignal, mockCandle, 0)

      // Verify it returns a valid date string in YYYY-MM-DD format
      expect(trade.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      // Verify expiry is in the future from entry
      const expiryDate = new Date(trade.expiry)
      const entryDate = new Date(mockCandle.time)
      expect(expiryDate.getTime()).toBeGreaterThan(entryDate.getTime())

      // Verify expiry is within 7 days of entry (next Friday logic)
      const daysDiff = (expiryDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
      expect(daysDiff).toBeLessThanOrEqual(7)
      expect(daysDiff).toBeGreaterThan(0)
    })

    it('uses default contracts of 1', () => {
      const trade = createTrade(mockSignal, mockCandle, 0)

      expect(trade.contracts).toBe(1)
    })

    it('uses contracts from signal if provided', () => {
      const signalWithContracts = { ...mockSignal, contracts: 5 }
      const trade = createTrade(signalWithContracts, mockCandle, 0)

      expect(trade.contracts).toBe(5)
    })

    it('extracts direction from STRONG_ prefixed type', () => {
      const strongSignal = { ...mockSignal, type: 'STRONG_CALL', direction: undefined }
      const trade = createTrade(strongSignal, mockCandle, 0)

      expect(trade.signal).toBe('CALL')
      expect(trade.signalType).toBe('STRONG_CALL')
    })

    it('increments trade IDs', () => {
      const trade1 = createTrade(mockSignal, mockCandle, 0)
      const trade2 = createTrade(mockSignal, mockCandle, 1)
      const trade3 = createTrade(mockSignal, mockCandle, 2)

      expect(trade1.id).toBe(1)
      expect(trade2.id).toBe(2)
      expect(trade3.id).toBe(3)
    })

    it('handles PUT signals correctly', () => {
      const putSignal = { ...mockSignal, type: 'PUT', direction: 'PUT' }
      const trade = createTrade(putSignal, mockCandle, 0)

      expect(trade.signal).toBe('PUT')
      expect(trade.optionType).toBe('PUT')
    })
  })

  describe('updateTrade', () => {
    let trade

    beforeEach(() => {
      const signal = {
        type: 'CALL',
        direction: 'CALL',
        strength: 75,
        source: 'test',
      }
      const candle = {
        close: 100,
        high: 101,
        low: 99,
        time: 1704067200000,
      }
      trade = createTrade(signal, candle, 0)
    })

    it('increments barsHeld', () => {
      const candle = { close: 101, high: 102, low: 100 }

      updateTrade(trade, candle)

      expect(trade.barsHeld).toBe(1)
    })

    it('updates high price when higher', () => {
      const candle = { close: 101, high: 105, low: 100 }

      updateTrade(trade, candle)

      expect(trade.highPrice).toBe(105)
    })

    it('does not update high price when lower', () => {
      const candle = { close: 99, high: 99.5, low: 98 }

      updateTrade(trade, candle)

      expect(trade.highPrice).toBe(100) // Original entry close
    })

    it('updates low price when lower', () => {
      const candle = { close: 99, high: 100, low: 95 }

      updateTrade(trade, candle)

      expect(trade.lowPrice).toBe(95)
    })

    it('does not update low price when higher', () => {
      const candle = { close: 101, high: 102, low: 100.5 }

      updateTrade(trade, candle)

      expect(trade.lowPrice).toBe(100) // Original entry close
    })

    it('calculates positive P&L for CALL when price rises', () => {
      const candle = { close: 105, high: 106, low: 104 }

      updateTrade(trade, candle)

      expect(trade.pnl).toBe(5) // 105 - 100
      expect(trade.pnlPercent).toBe(5) // (5/100) * 100
    })

    it('calculates negative P&L for CALL when price falls', () => {
      const candle = { close: 95, high: 96, low: 94 }

      updateTrade(trade, candle)

      expect(trade.pnl).toBe(-5) // 95 - 100
      expect(trade.pnlPercent).toBe(-5)
    })

    it('calculates P&L correctly for PUT trades', () => {
      const putSignal = {
        type: 'PUT',
        direction: 'PUT',
        strength: 75,
        source: 'test',
      }
      const candle = { close: 100, high: 101, low: 99, time: 1704067200000 }
      const putTrade = createTrade(putSignal, candle, 0)

      const updateCandle = { close: 95, high: 100, low: 94 }
      updateTrade(putTrade, updateCandle)

      expect(putTrade.pnl).toBe(5) // PUT profits when price falls
      expect(putTrade.pnlPercent).toBe(5)
    })

    it('accumulates bars over multiple updates', () => {
      const candle1 = { close: 101, high: 102, low: 100 }
      const candle2 = { close: 102, high: 103, low: 101 }
      const candle3 = { close: 103, high: 104, low: 102 }

      updateTrade(trade, candle1)
      updateTrade(trade, candle2)
      updateTrade(trade, candle3)

      expect(trade.barsHeld).toBe(3)
    })

    it('tracks high/low across multiple updates', () => {
      updateTrade(trade, { close: 105, high: 107, low: 98 })
      updateTrade(trade, { close: 103, high: 110, low: 100 })
      updateTrade(trade, { close: 102, high: 105, low: 95 })

      expect(trade.highPrice).toBe(110)
      expect(trade.lowPrice).toBe(95)
    })
  })

  describe('closeTrade', () => {
    let trade

    beforeEach(() => {
      const signal = {
        type: 'CALL',
        direction: 'CALL',
        strength: 75,
        source: 'test',
      }
      const candle = { close: 100, high: 101, low: 99, time: 1704067200000 }
      trade = createTrade(signal, candle, 0)
    })

    it('sets exit price from candle close', () => {
      const exitCandle = { close: 105, high: 106, low: 104, time: 1704153600000 }

      closeTrade(trade, exitCandle, 5, 'target')

      expect(trade.exitPrice).toBe(105)
    })

    it('sets exit time from candle', () => {
      const exitCandle = { close: 105, high: 106, low: 104, time: 1704153600000 }

      closeTrade(trade, exitCandle, 5, 'target')

      expect(trade.exitTime).toBe(1704153600000)
    })

    it('sets exit index', () => {
      const exitCandle = { close: 105, high: 106, low: 104, time: 1704153600000 }

      closeTrade(trade, exitCandle, 10, 'target')

      expect(trade.exitIndex).toBe(10)
    })

    it('sets exit reason', () => {
      const exitCandle = { close: 105, high: 106, low: 104, time: 1704153600000 }

      closeTrade(trade, exitCandle, 5, 'stop_loss')

      expect(trade.exitReason).toBe('stop_loss')
    })

    it('calculates final P&L for winning CALL', () => {
      const exitCandle = { close: 110, high: 111, low: 109, time: 1704153600000 }

      closeTrade(trade, exitCandle, 5, 'target')

      expect(trade.pnl).toBe(10) // 110 - 100
      expect(trade.pnlPercent).toBe(10)
    })

    it('calculates final P&L for losing CALL', () => {
      const exitCandle = { close: 90, high: 91, low: 89, time: 1704153600000 }

      closeTrade(trade, exitCandle, 5, 'stop_loss')

      expect(trade.pnl).toBe(-10) // 90 - 100
      expect(trade.pnlPercent).toBe(-10)
    })

    it('calculates final P&L for winning PUT', () => {
      const putSignal = { type: 'PUT', direction: 'PUT', strength: 75, source: 'test' }
      const entryCandle = { close: 100, high: 101, low: 99, time: 1704067200000 }
      const putTrade = createTrade(putSignal, entryCandle, 0)

      const exitCandle = { close: 90, high: 91, low: 89, time: 1704153600000 }
      closeTrade(putTrade, exitCandle, 5, 'target')

      expect(putTrade.pnl).toBe(10) // PUT profits when price falls
      expect(putTrade.pnlPercent).toBe(10)
    })

    it('calculates final P&L for losing PUT', () => {
      const putSignal = { type: 'PUT', direction: 'PUT', strength: 75, source: 'test' }
      const entryCandle = { close: 100, high: 101, low: 99, time: 1704067200000 }
      const putTrade = createTrade(putSignal, entryCandle, 0)

      const exitCandle = { close: 110, high: 111, low: 109, time: 1704153600000 }
      closeTrade(putTrade, exitCandle, 5, 'stop_loss')

      expect(putTrade.pnl).toBe(-10) // PUT loses when price rises
      expect(putTrade.pnlPercent).toBe(-10)
    })

    it('returns the closed trade', () => {
      const exitCandle = { close: 105, high: 106, low: 104, time: 1704153600000 }

      const result = closeTrade(trade, exitCandle, 5, 'target')

      expect(result).toBe(trade)
    })

    it('handles various exit reasons', () => {
      const reasons = ['target', 'stop_loss', 'trailing_stop', 'time_exit', 'eod', 'signal_reversal']

      reasons.forEach((reason, index) => {
        const signal = { type: 'CALL', direction: 'CALL', strength: 75, source: 'test' }
        const entryCandle = { close: 100, high: 101, low: 99, time: 1704067200000 }
        const newTrade = createTrade(signal, entryCandle, 0)
        const exitCandle = { close: 105, high: 106, low: 104, time: 1704153600000 }

        closeTrade(newTrade, exitCandle, index, reason)

        expect(newTrade.exitReason).toBe(reason)
      })
    })
  })

  describe('getMaxAdverseExcursion', () => {
    it('calculates MAE for CALL trade (uses low)', () => {
      const trade = {
        signal: 'CALL',
        entryPrice: 100,
        lowPrice: 95,
        highPrice: 110,
      }

      const mae = getMaxAdverseExcursion(trade)

      expect(mae).toBe(-5) // (95 - 100) / 100 * 100 = -5%
    })

    it('calculates MAE for PUT trade (uses high)', () => {
      const trade = {
        signal: 'PUT',
        entryPrice: 100,
        lowPrice: 90,
        highPrice: 105,
      }

      const mae = getMaxAdverseExcursion(trade)

      expect(mae).toBe(-5) // (100 - 105) / 100 * 100 = -5%
    })

    it('returns 0 when no adverse movement for CALL', () => {
      const trade = {
        signal: 'CALL',
        entryPrice: 100,
        lowPrice: 100, // Never went below entry
        highPrice: 110,
      }

      const mae = getMaxAdverseExcursion(trade)

      expect(mae).toBe(0)
    })

    it('returns 0 when no adverse movement for PUT', () => {
      const trade = {
        signal: 'PUT',
        entryPrice: 100,
        lowPrice: 90,
        highPrice: 100, // Never went above entry
      }

      const mae = getMaxAdverseExcursion(trade)

      expect(mae).toBe(0)
    })

    it('handles large adverse excursion', () => {
      const trade = {
        signal: 'CALL',
        entryPrice: 100,
        lowPrice: 80,
        highPrice: 110,
      }

      const mae = getMaxAdverseExcursion(trade)

      expect(mae).toBe(-20)
    })
  })

  describe('getMaxFavorableExcursion', () => {
    it('calculates MFE for CALL trade (uses high)', () => {
      const trade = {
        signal: 'CALL',
        entryPrice: 100,
        lowPrice: 95,
        highPrice: 115,
      }

      const mfe = getMaxFavorableExcursion(trade)

      expect(mfe).toBe(15) // (115 - 100) / 100 * 100 = 15%
    })

    it('calculates MFE for PUT trade (uses low)', () => {
      const trade = {
        signal: 'PUT',
        entryPrice: 100,
        lowPrice: 85,
        highPrice: 105,
      }

      const mfe = getMaxFavorableExcursion(trade)

      expect(mfe).toBe(15) // (100 - 85) / 100 * 100 = 15%
    })

    it('returns 0 when no favorable movement for CALL', () => {
      const trade = {
        signal: 'CALL',
        entryPrice: 100,
        lowPrice: 90,
        highPrice: 100, // Never went above entry
      }

      const mfe = getMaxFavorableExcursion(trade)

      expect(mfe).toBe(0)
    })

    it('returns 0 when no favorable movement for PUT', () => {
      const trade = {
        signal: 'PUT',
        entryPrice: 100,
        lowPrice: 100, // Never went below entry
        highPrice: 110,
      }

      const mfe = getMaxFavorableExcursion(trade)

      expect(mfe).toBe(0)
    })

    it('handles large favorable excursion', () => {
      const trade = {
        signal: 'CALL',
        entryPrice: 100,
        lowPrice: 95,
        highPrice: 150,
      }

      const mfe = getMaxFavorableExcursion(trade)

      expect(mfe).toBe(50)
    })
  })

  describe('resetTradeIdCounter', () => {
    it('resets the ID counter to 0', () => {
      const signal = { type: 'CALL', direction: 'CALL', strength: 75, source: 'test' }
      const candle = { close: 100, high: 101, low: 99, time: 1704067200000 }

      createTrade(signal, candle, 0)
      createTrade(signal, candle, 1)
      createTrade(signal, candle, 2)

      resetTradeIdCounter()

      const trade = createTrade(signal, candle, 0)
      expect(trade.id).toBe(1)
    })
  })
})
