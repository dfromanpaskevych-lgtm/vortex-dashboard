import { describe, it, expect } from "vitest";

/**
 * Tests for the RG enrichment matching strategy.
 * The bug was: RG enrichment matched by code+brand globally (across ALL orders),
 * causing supplier data to be assigned to wrong order items when the same article
 * appeared in multiple orders or multiple times in one order.
 *
 * Fix: 3-tier matching strategy:
 *   1. order_item_id (exact match, unique per line)
 *   2. vortexOrderId + code + brand (scoped to one order)
 *   3. code + brand (cross-order fallback, least precise)
 * With qty-based disambiguation when multiple candidates exist.
 */

// Simulate the matching logic extracted from syncService.ts
interface SyncedItem {
  id: number;
  vortexOrderId: string;
  orderItemId: string | null;
  code: string | null;
  brandName: string | null;
  supplierName: string | null;
  qty: number | null;
}

interface RgItem {
  art_id?: string;
  code?: string;
  brand?: string;
  order_item_id?: string;
  item_id?: string;
  price?: number;
  qty?: number;
}

interface RgEntry {
  items: RgItem[];
  sup_name: string;
  id: string;
  timestamp?: number;
  currency?: string;
  order_id?: string;
}

function buildIndexes(allSyncedItems: SyncedItem[]) {
  const byOrderItemId = new Map<string, SyncedItem>();
  const byOrderCodeBrand = new Map<string, SyncedItem[]>();
  const byCodeBrand = new Map<string, SyncedItem[]>();

  for (const item of allSyncedItems) {
    if (item.orderItemId) {
      byOrderItemId.set(item.orderItemId, item);
    }
    const key1 = `${item.vortexOrderId}:${(item.code || "").toLowerCase()}:${(item.brandName || "").toLowerCase()}`;
    if (!byOrderCodeBrand.has(key1)) byOrderCodeBrand.set(key1, []);
    byOrderCodeBrand.get(key1)!.push(item);

    const key2 = `${(item.code || "").toLowerCase()}:${(item.brandName || "").toLowerCase()}`;
    if (!byCodeBrand.has(key2)) byCodeBrand.set(key2, []);
    byCodeBrand.get(key2)!.push(item);
  }

  return { byOrderItemId, byOrderCodeBrand, byCodeBrand };
}

function matchRgItem(
  rgItem: RgItem,
  rgOrderId: string,
  indexes: ReturnType<typeof buildIndexes>,
  enrichedIds: Set<number>
): SyncedItem | undefined {
  const code = String(rgItem.code || "");
  const brand = String(rgItem.brand || "");
  const rgItemOrderItemId = String(rgItem.order_item_id || rgItem.item_id || "");
  const rgQty = rgItem.qty != null ? Number(rgItem.qty) : null;

  let matched: SyncedItem | undefined;

  // Strategy 1: Match by order_item_id
  if (rgItemOrderItemId && indexes.byOrderItemId.has(rgItemOrderItemId)) {
    const candidate = indexes.byOrderItemId.get(rgItemOrderItemId)!;
    if (!candidate.supplierName && !enrichedIds.has(candidate.id)) {
      matched = candidate;
    }
  }

  // Strategy 2: Match by order_id + code + brand
  if (!matched && rgOrderId) {
    const key = `${rgOrderId}:${code.toLowerCase()}:${brand.toLowerCase()}`;
    const candidates = indexes.byOrderCodeBrand.get(key) || [];
    if (rgQty != null) {
      matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id) && c.qty === rgQty);
    }
    if (!matched) {
      matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id));
    }
  }

  // Strategy 3: Fallback by code + brand
  if (!matched) {
    const key = `${code.toLowerCase()}:${brand.toLowerCase()}`;
    const candidates = indexes.byCodeBrand.get(key) || [];
    if (rgQty != null) {
      matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id) && c.qty === rgQty);
    }
    if (!matched) {
      matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id));
    }
  }

  return matched;
}

describe("RG enrichment matching", () => {
  it("should match by order_item_id when available (Strategy 1)", () => {
    const items: SyncedItem[] = [
      { id: 1, vortexOrderId: "100", orderItemId: "item_1", code: "102782", brandName: "BOSCH", supplierName: null, qty: 1 },
      { id: 2, vortexOrderId: "100", orderItemId: "item_2", code: "102782", brandName: "BOSCH", supplierName: null, qty: 2 },
    ];
    const indexes = buildIndexes(items);
    const enrichedIds = new Set<number>();

    // RG item with order_item_id should match exactly
    const match = matchRgItem(
      { code: "102782", brand: "BOSCH", order_item_id: "item_2", qty: 2, price: 500 },
      "100",
      indexes,
      enrichedIds
    );

    expect(match).toBeDefined();
    expect(match!.id).toBe(2); // Should match item_2, not item_1
    expect(match!.orderItemId).toBe("item_2");
  });

  it("should NOT match wrong order when same article exists in multiple orders (old bug)", () => {
    const items: SyncedItem[] = [
      { id: 1, vortexOrderId: "100", orderItemId: "item_1", code: "102782", brandName: "BOSCH", supplierName: null, qty: 1 },
      { id: 2, vortexOrderId: "200", orderItemId: "item_2", code: "102782", brandName: "BOSCH", supplierName: null, qty: 2 },
    ];
    const indexes = buildIndexes(items);
    const enrichedIds = new Set<number>();

    // RG for order 200 should match item in order 200, not order 100
    const match = matchRgItem(
      { code: "102782", brand: "BOSCH", qty: 2, price: 500 },
      "200",
      indexes,
      enrichedIds
    );

    expect(match).toBeDefined();
    expect(match!.id).toBe(2); // Must be from order 200
    expect(match!.vortexOrderId).toBe("200");
  });

  it("should disambiguate by qty when same article appears twice in one order", () => {
    const items: SyncedItem[] = [
      { id: 1, vortexOrderId: "100", orderItemId: "item_1", code: "102782", brandName: "BOSCH", supplierName: null, qty: 1 },
      { id: 2, vortexOrderId: "100", orderItemId: "item_2", code: "102782", brandName: "BOSCH", supplierName: null, qty: 2 },
    ];
    const indexes = buildIndexes(items);
    const enrichedIds = new Set<number>();

    // RG with qty=2 should match item with qty=2
    const match = matchRgItem(
      { code: "102782", brand: "BOSCH", qty: 2, price: 860 },
      "100",
      indexes,
      enrichedIds
    );

    expect(match).toBeDefined();
    expect(match!.id).toBe(2);
    expect(match!.qty).toBe(2);
  });

  it("should not double-enrich the same item", () => {
    const items: SyncedItem[] = [
      { id: 1, vortexOrderId: "100", orderItemId: "item_1", code: "102782", brandName: "BOSCH", supplierName: null, qty: 1 },
    ];
    const indexes = buildIndexes(items);
    const enrichedIds = new Set<number>();

    // First match succeeds
    const match1 = matchRgItem(
      { code: "102782", brand: "BOSCH", qty: 1, price: 500 },
      "100",
      indexes,
      enrichedIds
    );
    expect(match1).toBeDefined();
    enrichedIds.add(match1!.id);
    match1!.supplierName = "Supplier A"; // simulate enrichment

    // Second match for same code+brand should NOT match (already enriched)
    const match2 = matchRgItem(
      { code: "102782", brand: "BOSCH", qty: 1, price: 600 },
      "100",
      indexes,
      enrichedIds
    );
    expect(match2).toBeUndefined();
  });

  it("should handle the real bug scenario: swapped prices between clients (D65156652)", () => {
    // Two different orders, same article, different clients with different prices
    const items: SyncedItem[] = [
      { id: 10, vortexOrderId: "500", orderItemId: "oi_10", code: "D65156652", brandName: "TRW", supplierName: null, qty: 1 },
      { id: 11, vortexOrderId: "501", orderItemId: "oi_11", code: "D65156652", brandName: "TRW", supplierName: null, qty: 1 },
    ];
    const indexes = buildIndexes(items);
    const enrichedIds = new Set<number>();

    // RG for order 500 (Мерцало) with price 900
    const match1 = matchRgItem(
      { code: "D65156652", brand: "TRW", order_item_id: "oi_10", qty: 1, price: 900 },
      "500",
      indexes,
      enrichedIds
    );
    expect(match1).toBeDefined();
    expect(match1!.vortexOrderId).toBe("500");
    enrichedIds.add(match1!.id);
    match1!.supplierName = "Supplier X";

    // RG for order 501 (Михайловський) with price 876
    const match2 = matchRgItem(
      { code: "D65156652", brand: "TRW", order_item_id: "oi_11", qty: 1, price: 876 },
      "501",
      indexes,
      enrichedIds
    );
    expect(match2).toBeDefined();
    expect(match2!.vortexOrderId).toBe("501"); // Must NOT be 500!
    expect(match2!.id).toBe(11);
  });

  it("should use Strategy 2 (order_id + code + brand) when no order_item_id in RG", () => {
    const items: SyncedItem[] = [
      { id: 1, vortexOrderId: "100", orderItemId: null, code: "ABC123", brandName: "MANN", supplierName: null, qty: 3 },
      { id: 2, vortexOrderId: "200", orderItemId: null, code: "ABC123", brandName: "MANN", supplierName: null, qty: 5 },
    ];
    const indexes = buildIndexes(items);
    const enrichedIds = new Set<number>();

    // RG has order_id=200 but no order_item_id
    const match = matchRgItem(
      { code: "ABC123", brand: "MANN", qty: 5, price: 100 },
      "200",
      indexes,
      enrichedIds
    );

    expect(match).toBeDefined();
    expect(match!.id).toBe(2);
    expect(match!.vortexOrderId).toBe("200");
  });

  it("should fall back to Strategy 3 (code + brand only) when no order_id in RG", () => {
    const items: SyncedItem[] = [
      { id: 1, vortexOrderId: "100", orderItemId: null, code: "XYZ789", brandName: "FEBI", supplierName: null, qty: 1 },
    ];
    const indexes = buildIndexes(items);
    const enrichedIds = new Set<number>();

    // RG has no order_id and no order_item_id
    const match = matchRgItem(
      { code: "XYZ789", brand: "FEBI", qty: 1, price: 200 },
      "", // no order_id
      indexes,
      enrichedIds
    );

    expect(match).toBeDefined();
    expect(match!.id).toBe(1);
  });
});
