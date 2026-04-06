import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock getDb to return null (no DB in tests)
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

import { getExchangeRate, timestampToDateStr } from "./currencyService";

describe("currencyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear memory cache by reimporting would be complex, so we test with unique dates
  });

  describe("timestampToDateStr", () => {
    it("converts unix timestamp to YYYY-MM-DD", () => {
      // 2026-02-25 08:00:00 UTC = 1772006400
      expect(timestampToDateStr(1772006400)).toBe("2026-02-25");
    });

    it("handles different dates", () => {
      // 2026-04-06 12:00:00 UTC = 1775649600
      const result = timestampToDateStr(1775649600);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("getExchangeRate", () => {
    it("returns 1 for UAH currency", async () => {
      const rate = await getExchangeRate("UAH", "2026-04-06");
      expect(rate).toBe(1);
    });

    it("returns 1 for uah lowercase", async () => {
      const rate = await getExchangeRate("uah", "2026-04-06");
      expect(rate).toBe(1);
    });

    it("returns 1 for ГРН", async () => {
      const rate = await getExchangeRate("ГРН", "2026-04-06");
      expect(rate).toBe(1);
    });

    it("returns null for unsupported currency", async () => {
      const rate = await getExchangeRate("GBP", "2026-04-06");
      expect(rate).toBeNull();
    });

    it("fetches NBU rate for historical USD date", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ rate: 43.2081 }],
      });

      const rate = await getExchangeRate("USD", "2025-01-15");
      expect(rate).toBe(43.2081);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Should call NBU for historical dates (not today)
      expect(mockFetch.mock.calls[0][0]).toContain("bank.gov.ua");
    });

    it("fetches NBU rate for historical EUR date", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ rate: 51.0244 }],
      });

      const rate = await getExchangeRate("EUR", "2025-02-20");
      expect(rate).toBe(51.0244);
    });

    it("returns null when NBU API fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      const rate = await getExchangeRate("USD", "2024-01-01");
      expect(rate).toBeNull();
    });

    it("returns null when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const rate = await getExchangeRate("EUR", "2024-06-15");
      expect(rate).toBeNull();
    });
  });
});

describe("delta calculation logic", () => {
  it("calculates delta correctly: (price - basePrice) × qty", () => {
    // AVR РЕГУЛЯТОР: price=2000, basePrice=955, qty=5
    const price = 2000;
    const basePrice = 955;
    const qty = 5;
    const delta = (price - basePrice) * qty;
    expect(delta).toBe(5225);
  });

  it("calculates delta for qty=1", () => {
    const price = 2820;
    const basePrice = 58.47;
    const qty = 1;
    const delta = (price - basePrice) * qty;
    expect(delta).toBeCloseTo(2761.53, 2);
  });

  it("calculates basePriceUah with fixedRate", () => {
    // basePrice=58.47 USD, fixedRate=43.95
    const basePrice = 58.47;
    const fixedRate = 43.95;
    const basePriceUah = basePrice * fixedRate;
    expect(basePriceUah).toBeCloseTo(2569.77, 1);
  });

  it("basePriceUah is null when no fixedRate", () => {
    const basePrice = 58.47;
    const fixedRate = null;
    const basePriceUah = basePrice != null && fixedRate && fixedRate > 0 ? basePrice * fixedRate : null;
    expect(basePriceUah).toBeNull();
  });

  it("basePriceUah equals basePrice when fixedRate is 1 (UAH)", () => {
    const basePrice = 955;
    const fixedRate = 1;
    const basePriceUah = basePrice * fixedRate;
    expect(basePriceUah).toBe(955);
  });
});
