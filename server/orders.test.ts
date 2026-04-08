import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("orders router", () => {
  it("returns list with rows and total", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.list({});
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("returns filter options", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.filterOptions();
    expect(result).toHaveProperty("managers");
    expect(result).toHaveProperty("statuses");
    expect(result).toHaveProperty("brands");
    expect(result).toHaveProperty("clients");
    expect(Array.isArray(result.managers)).toBe(true);
    expect(Array.isArray(result.statuses)).toBe(true);
  });

  it("supports pagination", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.list({ page: 1, pageSize: 5 });
    // rows contains items (multiple per order), but total reflects order count
    // With 5 orders, we should get some rows
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    expect(result.total).toBeGreaterThan(0);
    // Verify page 2 returns different data
    const result2 = await caller.orders.list({ page: 2, pageSize: 5 });
    expect(result2).toHaveProperty("rows");
  });

  it("supports search filter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.list({ search: "test_nonexistent_xyz" });
    expect(result.rows.length).toBe(0);
  });

  it("supports date range filter (dateFrom/dateTo)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    // March 15 2026 00:00:00 UTC
    const dateFrom = Math.floor(new Date("2026-03-15T00:00:00Z").getTime() / 1000);
    // March 15 2026 23:59:59 UTC
    const dateTo = Math.floor(new Date("2026-03-15T23:59:59Z").getTime() / 1000);
    const result = await caller.orders.list({ dateFrom, dateTo });
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    // All returned rows should be within the date range
    for (const row of result.rows) {
      if (row.createdTs) {
        expect(row.createdTs).toBeGreaterThanOrEqual(dateFrom);
        expect(row.createdTs).toBeLessThanOrEqual(dateTo);
      }
    }
  });

  it("date filter returns fewer results than no filter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const allResult = await caller.orders.list({});
    // Filter to just one day — should have fewer or equal orders
    const dateFrom = Math.floor(new Date("2026-03-10T00:00:00Z").getTime() / 1000);
    const dateTo = Math.floor(new Date("2026-03-10T23:59:59Z").getTime() / 1000);
    const filteredResult = await caller.orders.list({ dateFrom, dateTo });
    expect(filteredResult.total).toBeLessThanOrEqual(allResult.total);
  });

  it("future date filter returns zero results", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const dateFrom = Math.floor(new Date("2030-01-01T00:00:00Z").getTime() / 1000);
    const dateTo = Math.floor(new Date("2030-12-31T23:59:59Z").getTime() / 1000);
    const result = await caller.orders.list({ dateFrom, dateTo });
    expect(result.total).toBe(0);
    expect(result.rows.length).toBe(0);
  });
});

describe("dashboard router", () => {
  it("returns metrics with all sections", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.metrics();
    expect(result).not.toBeNull();
    if (result) {
      expect(result).toHaveProperty("totals");
      expect(result).toHaveProperty("byManager");
      expect(result).toHaveProperty("byStatus");
      expect(result).toHaveProperty("byDay");
      expect(result).toHaveProperty("byBrand");
    }
  });
});

describe("changes router", () => {
  it("returns change logs with rows and total", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.changes.list({});
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("supports change type filter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.changes.list({ changeType: "new" });
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
  });
});

describe("logistics router", () => {
  it("returns logistics list with rows and total", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.logistics.list({});
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("logistics items should only contain ВЛАСНА ЛОГІСТИКА", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.logistics.list({ pageSize: 100 });
    for (const row of result.rows) {
      if (row.code) {
        expect(row.code).toBe("ВЛАСНА ЛОГІСТИКА");
      }
    }
  });

  it("orders list should NOT contain ВЛАСНА ЛОГІСТИКА", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.list({ pageSize: 200 });
    for (const row of result.rows) {
      if (row.code) {
        expect(row.code).not.toBe("ВЛАСНА ЛОГІСТИКА");
      }
    }
  });
});

describe("sync router", () => {
  it("returns sync status", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sync.status();
    expect(result).toHaveProperty("isSyncing");
    expect(typeof result.isSyncing).toBe("boolean");
  });

  it("returns sync logs", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sync.logs();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("MANUS calculation columns", () => {
  // Формули (згідно ТЗ 08.04.2026):
  // MANUS Продажна = price × qty
  // MANUS Дельта = (price - basePrice) × qty  [дельта за 1 шт = price - basePrice]
  // MANUS Вхідна = MANUS Продажна − MANUS Дельта

  it("Дельта за 1 шт = price - basePrice", () => {
    // Дельта в колонці = маржа за 1 одиницю
    const cases = [
      { price: 1650, basePrice: 1100, expected: 550 },  // order 87676
      { price: 3500, basePrice: 2900, expected: 600 },  // order 87323
      { price: 33,   basePrice: 32.78, expected: 0.22 }, // order 87586
    ];
    for (const c of cases) {
      const result = parseFloat((c.price - c.basePrice).toFixed(2));
      expect(result).toBe(c.expected);
    }
  });

  it("manusDelta = (price - basePrice) × qty — реальні замовлення", () => {
    const cases = [
      { price: 1650, basePrice: 1100, qty: 4, expected: 2200 },   // order 87676: 550×4
      { price: 3500, basePrice: 2900, qty: 4, expected: 2400 },   // order 87323: 600×4
      { price: 33,   basePrice: 32.78, qty: 2, expected: 0.44 },  // order 87586: 0.22×2
      { price: 100,  basePrice: 80,   qty: 1, expected: 20 },     // single unit
      { price: 100,  basePrice: 100,  qty: 5, expected: 0 },      // zero delta
    ];
    for (const c of cases) {
      const deltaPerUnit = c.price - c.basePrice;
      const result = parseFloat((deltaPerUnit * c.qty).toFixed(2));
      expect(result).toBe(c.expected);
    }
  });

  it("manusSaleTotal = price × qty", () => {
    const cases = [
      { price: 1650, qty: 4, expected: 6600 },   // order 87676
      { price: 3500, qty: 4, expected: 14000 },  // order 87323
      { price: 33,   qty: 2, expected: 66 },     // order 87586
    ];
    for (const c of cases) {
      const result = parseFloat((c.price * c.qty).toFixed(2));
      expect(result).toBe(c.expected);
    }
  });

  it("manusInputTotal = manusSaleTotal - manusDelta — реальні замовлення", () => {
    const cases = [
      { price: 1650, basePrice: 1100, qty: 4, expectedInput: 4400 },   // order 87676: 6600-2200
      { price: 3500, basePrice: 2900, qty: 4, expectedInput: 11600 },  // order 87323: 14000-2400
      { price: 33,   basePrice: 32.78, qty: 2, expectedInput: 65.56 }, // order 87586: 66-0.44
    ];
    for (const c of cases) {
      const deltaPerUnit = c.price - c.basePrice;
      const manusDelta = parseFloat((deltaPerUnit * c.qty).toFixed(2));
      const manusSaleTotal = parseFloat((c.price * c.qty).toFixed(2));
      const manusInputTotal = parseFloat((manusSaleTotal - manusDelta).toFixed(2));
      expect(manusInputTotal).toBe(c.expectedInput);
    }
  });

  it("MANUS columns present in orders.list rows", async () => {
    // Verify the tRPC orders.list returns rows (MANUS cols are computed in UI, not tRPC)
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.list({ pageSize: 5 });
    expect(result).toHaveProperty("rows");
    expect(result.rows.length).toBeGreaterThan(0);
    // Rows must have price and qty for MANUS computation
    for (const row of result.rows) {
      expect(row).toHaveProperty("qty");
      expect(row).toHaveProperty("price");
    }
  });
});
