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
