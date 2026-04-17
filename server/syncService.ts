import { eq, desc, and, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { orders, orderItems, orderSnapshots, changeLogs, syncLogs, syncRuns } from "../drizzle/schema";
import { fetchOrdersByDateRange, fetchRgByDateRange, getOrderById } from "./vortexClient";
import { nanoid } from "nanoid";
import { fireSyncWebhooks } from "./webhookService";
import { getExchangeRate, timestampToDateStr } from "./currencyService";

let isSyncing = false;
let cancelRequested = false;

/**
 * Request cancellation of the current chunked sync.
 * The running chunk completes, then no further chunks are started.
 */
export function cancelSync(): { success: boolean; message: string } {
  if (!isSyncing) {
    return { success: false, message: "No sync is currently running" };
  }
  cancelRequested = true;
  console.log("[Sync] Cancellation requested — will stop after current chunk");
  return { success: true, message: "Cancellation requested. Current chunk will finish, then sync will stop." };
}

export function isCancelPending(): boolean {
  return cancelRequested;
}

export async function getSyncStatus() {
  const db = await getDb();
  if (!db) return { isSyncing, lastSync: null };

  const [lastSync] = await db
    .select()
    .from(syncLogs)
    .orderBy(desc(syncLogs.startedAt))
    .limit(1);

  return { isSyncing, lastSync: lastSync || null };
}

/**
 * Helper: map raw Vortex order to DB fields.
 */
/**
 * Truncate a string to maxLen characters to prevent DB VARCHAR overflow.
 * Logs a warning when truncation occurs so we can track data quality issues.
 */
function truncate(value: string | null | undefined, maxLen: number, field: string): string | null {
  if (!value) return value ?? null;
  if (value.length <= maxLen) return value;
  console.warn(`[Sync] TRUNCATE ${field}: ${value.length} chars → ${maxLen} (value: ${value.slice(0, 80)}...)`);
  return value.slice(0, maxLen);
}

function mapOrderToDb(rawOrder: Record<string, unknown>) {
  const vortexOrderId = String(rawOrder.order_id || rawOrder.id || "");
  const sumData = rawOrder.sum as Record<string, unknown> | undefined;
  const deliveryData = rawOrder.delivery_data as Record<string, unknown> | undefined;

  return {
    vortexOrderId,
    clientId: String(rawOrder.client_id || ""),
    clientName: String(rawOrder.client_name || "").trim(),
    managerName: String(rawOrder.manager_name || "").trim(),
    currency: String(rawOrder.currency || "uah"),
    clientNote: String(rawOrder.client_note || ""),
    managerNote: String(rawOrder.manager_note || ""),
    sumUah: sumData?.uah != null ? String(sumData.uah) : null,
    sumUsd: sumData?.usd != null ? String(sumData.usd) : null,
    sumEur: sumData?.eur != null ? String(sumData.eur) : null,
    deliveryProvider: deliveryData?.delivery_name ? String(deliveryData.delivery_name) : null,
    deliveryName: deliveryData?.delivery_name ? String(deliveryData.delivery_name) : null,
    customerPhone: truncate(deliveryData?.customer_phone ? String(deliveryData.customer_phone) : null, 500, "customerPhone"),
    trackNumber: truncate(deliveryData?.track_number ? String(deliveryData.track_number) : null, 500, "trackNumber"),
    cityName: truncate(deliveryData?.city_name ? String(deliveryData.city_name) : null, 100, "cityName"),
    instanceName: deliveryData?.instance_name ? String(deliveryData.instance_name) : null,
    paymentName: truncate(deliveryData?.payment_name ? String(deliveryData.payment_name) : null, 100, "paymentName"),
    codAmount: deliveryData?.cod_amount != null ? String(deliveryData.cod_amount) : null,
    codCurrency: deliveryData?.cod_currency ? String(deliveryData.cod_currency) : null,
    rawJson: rawOrder,
    createdTs: rawOrder.created ? Number(rawOrder.created) : null,
    syncedAt: new Date(),
  };
}

/**
 * Helper: map raw Vortex item to DB fields.
 * fixedRate/fixedRateDate are added separately after async currency lookup.
 */
function mapItemToDb(item: Record<string, unknown>, orderId: number, vortexOrderId: string) {
  return {
    orderId,
    vortexOrderId,
    orderItemId: truncate(String(item.order_item_id || ""), 32, "orderItemId"),
    code: truncate(String(item.code || ""), 500, "code"),
    brandName: truncate(String(item.brand_name || ""), 100, "brandName"),
    description: String(item.description || "").trim(),
    status: String(item.status || ""),
    whName: item.wh_name ? String(item.wh_name) : null,
    whId: item.wh_id ? String(item.wh_id) : null,
    qty: item.qty ? Number(item.qty) : null,
    price: item.price != null ? String(item.price) : null,
    basePrice: item.base_price != null ? String(item.base_price) : null,
    basePriceCurrency: String(item.base_price_currency || "uah"),
    retailPrice: item.retail_price != null ? String(item.retail_price) : null,
    currency: String(item.currency || "uah"),
    deliveryTime: item.delivery_time ? Number(item.delivery_time) : null,
    realDeliveryTime: item.real_delivery_time ? Number(item.real_delivery_time) : null,
    deliveryName: item.delivery_name ? String(item.delivery_name) : null,
    clientNote: String(item.client_note || ""),
    managerNote: String(item.manager_note || ""),
    returnPeriod: String(item.return_period || "0"),
  };
}

/**
 * Get fixedRate for an item based on its currency and order creation date.
 * For UAH items, rate = 1. For EUR/USD, fetch from Monobank/NBU.
 * If item already has a fixedRate in DB, preserve it (immutable).
 */
async function getFixedRateForItem(
  basePriceCurrency: string,
  orderCreatedTs: number | null,
  existingFixedRate?: string | null
): Promise<{ fixedRate: string | null; fixedRateDate: string | null }> {
  // If already has a fixed rate, keep it (immutable)
  if (existingFixedRate && Number(existingFixedRate) > 0) {
    return { fixedRate: null, fixedRateDate: null }; // signal: don't overwrite
  }

  const cur = (basePriceCurrency || "uah").toUpperCase();
  if (cur === "UAH" || cur === "ГРН") {
    return { fixedRate: "1.0000", fixedRateDate: orderCreatedTs ? timestampToDateStr(orderCreatedTs) : new Date().toISOString().slice(0, 10) };
  }

  const dateStr = orderCreatedTs ? timestampToDateStr(orderCreatedTs) : new Date().toISOString().slice(0, 10);
  const rate = await getExchangeRate(cur, dateStr);
  if (rate !== null) {
    return { fixedRate: String(rate.toFixed(4)), fixedRateDate: dateStr };
  }
  return { fixedRate: null, fixedRateDate: dateStr };
}

/**
 * Detect changes between existing and new order data.
 * Returns array of field-level changes.
 */
function detectChanges(
  existing: Record<string, unknown>,
  newData: Record<string, unknown>,
  existingItems: Array<Record<string, unknown>>,
  newItems: Array<Record<string, unknown>>
): Array<{ field: string; oldVal: string; newVal: string }> {
  const changes: Array<{ field: string; oldVal: string; newVal: string }> = [];

  // Normalize numeric strings for comparison ("11356.00" == "11356")
  function normalizeNum(v: unknown): string {
    if (v == null || v === "") return "";
    const s = String(v).trim();
    const n = Number(s);
    if (!isNaN(n)) return String(n);
    return s;
  }

  // Check order-level fields
  const textFields = [
    ["clientName", "clientName"],
    ["managerName", "managerName"],
    ["customerPhone", "customerPhone"],
    ["trackNumber", "trackNumber"],
    ["deliveryName", "deliveryName"],
    ["currency", "currency"],
    ["clientNote", "clientNote"],
    ["managerNote", "managerNote"],
    ["paymentName", "paymentName"],
  ];
  const numericFields = [
    ["sumUah", "sumUah"],
    ["sumUsd", "sumUsd"],
    ["sumEur", "sumEur"],
    ["codAmount", "codAmount"],
  ];

  for (const [fieldLabel, fieldKey] of textFields) {
    const oldVal = String(existing[fieldKey] ?? "").trim();
    const newVal = String((newData as Record<string, unknown>)[fieldKey] ?? "").trim();
    if (oldVal !== newVal) {
      changes.push({ field: fieldLabel, oldVal, newVal });
    }
  }
  for (const [fieldLabel, fieldKey] of numericFields) {
    const oldVal = normalizeNum(existing[fieldKey]);
    const newVal = normalizeNum((newData as Record<string, unknown>)[fieldKey]);
    if (oldVal !== newVal) {
      changes.push({ field: fieldLabel, oldVal, newVal });
    }
  }

  // Check items count
  if (existingItems.length !== newItems.length) {
    changes.push({
      field: "items_count",
      oldVal: String(existingItems.length),
      newVal: String(newItems.length),
    });
  }

  // Check item-level changes (status, price, qty)
  for (const newItem of newItems) {
    const newItemId = String(newItem.order_item_id || "");
    const existingItem = existingItems.find(
      (ei: Record<string, unknown>) => String(ei.orderItemId || "") === newItemId
    );

    if (existingItem) {
      const itemCode = String(newItem.code || newItemId);

      // Status change
      if (String(existingItem.status || "") !== String(newItem.status || "")) {
        changes.push({
          field: `item_status [${itemCode}]`,
          oldVal: String(existingItem.status || ""),
          newVal: String(newItem.status || ""),
        });
      }

      // Base price change
      const oldBase = normalizeNum(existingItem.basePrice);
      const newBase = normalizeNum(newItem.base_price);
      if (oldBase !== newBase) {
        changes.push({
          field: `item_base_price [${itemCode}]`,
          oldVal: oldBase,
          newVal: newBase,
        });
      }

      // Sale price (price) change
      const oldPrice = normalizeNum(existingItem.price);
      const newPrice = normalizeNum(newItem.price);
      if (oldPrice !== newPrice) {
        changes.push({
          field: `item_price [${itemCode}]`,
          oldVal: oldPrice,
          newVal: newPrice,
        });
      }

      // Retail price change
      const oldRetail = normalizeNum(existingItem.retailPrice);
      const newRetail = normalizeNum(newItem.retail_price);
      if (oldRetail !== newRetail) {
        changes.push({
          field: `item_retail_price [${itemCode}]`,
          oldVal: oldRetail,
          newVal: newRetail,
        });
      }

      // Qty change
      const oldQty = normalizeNum(existingItem.qty);
      const newQty = normalizeNum(newItem.qty);
      if (oldQty !== newQty) {
        changes.push({
          field: `item_qty [${itemCode}]`,
          oldVal: oldQty,
          newVal: newQty,
        });
      }

      // Warehouse change
      const oldWh = String(existingItem.whName ?? "");
      const newWh = newItem.wh_name ? String(newItem.wh_name) : "";
      if (oldWh !== newWh) {
        changes.push({
          field: `item_warehouse [${itemCode}]`,
          oldVal: oldWh,
          newVal: newWh,
        });
      }
    } else {
      // New item added to existing order
      changes.push({
        field: `item_added [${String(newItem.code || newItemId)}]`,
        oldVal: "",
        newVal: `qty=${newItem.qty || 0}, status=${newItem.status || ""}`,
      });
    }
  }

  // Check for removed items
  for (const existingItem of existingItems) {
    const existingItemId = String((existingItem as Record<string, unknown>).orderItemId || "");
    const stillExists = newItems.find(
      (ni) => String(ni.order_item_id || "") === existingItemId
    );
    if (!stillExists) {
      const itemCode = String((existingItem as Record<string, unknown>).code || existingItemId);
      changes.push({
        field: `item_removed [${itemCode}]`,
        oldVal: `qty=${(existingItem as Record<string, unknown>).qty || 0}, status=${(existingItem as Record<string, unknown>).status || ""}`,
        newVal: "",
      });
    }
  }

  return changes;
}

/**
 * Manual manager overrides for specific Vortex order IDs
 * where the API returns the wrong manager and there's no paired EUR order to copy from.
 */
const MANUAL_MANAGER_OVERRIDES: Record<string, string> = {
  "85899": "В. Шмагленко (@allparts_Vad_sh)",  // О. Кісільчук → В. Шмагленко (invoice 56962)
  "87695": "М. Мілінічук (СТО)",              // Є. Бардаш → М. Мілінічук (invoice 57521)
  "86762": "І. Платонов",                      // І. Гопанчук (адмінка) → І. Платонов (invoice 56966)
};

/**
 * Admin manager patterns to detect.
 */
const ADMIN_PATTERNS = ["Адмінка", "Київ Адмін"];

function isAdminManager(managerName: string): boolean {
  return ADMIN_PATTERNS.some(p => managerName.includes(p));
}

/**
 * Post-processing: fix admin manager names.
 * For each admin order, find a paired non-admin order from the same client_id + same created timestamp.
 * If found, copy the real manager name. Also apply manual overrides.
 */
async function fixAdminManagers(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  fetchedOrders: Array<Record<string, unknown>>
): Promise<void> {
  // Group fetched orders by client_id
  const byClient: Record<string, Array<Record<string, unknown>>> = {};
  for (const o of fetchedOrders) {
    const cid = String(o.client_id || "");
    if (!cid) continue;
    if (!byClient[cid]) byClient[cid] = [];
    byClient[cid].push(o);
  }

  let fixedByPair = 0;
  let fixedByOverride = 0;
  let fixedByDayPair = 0;

  for (const [clientId, clientOrders] of Object.entries(byClient)) {
    for (const order of clientOrders) {
      const vortexOrderId = String(order.order_id || order.id || "");
      const managerName = String(order.manager_name || "").trim();

      // Check manual overrides first
      if (MANUAL_MANAGER_OVERRIDES[vortexOrderId]) {
        const correctManager = MANUAL_MANAGER_OVERRIDES[vortexOrderId];
        if (managerName !== correctManager) {
          await db
            .update(orders)
            .set({ managerName: correctManager })
            .where(eq(orders.vortexOrderId, vortexOrderId));
          console.log(`[Sync] OVERRIDE manager for order ${vortexOrderId}: "${managerName}" → "${correctManager}"`);
          fixedByOverride++;
        }
        continue;
      }

      // Only process admin managers
      if (!isAdminManager(managerName)) continue;

      // Strategy 1: Find paired non-admin order with same client_id + same created timestamp
      const created = String(order.created || "");
      let pair = clientOrders.find(other => {
        const otherId = String(other.order_id || other.id || "");
        const otherMgr = String(other.manager_name || "").trim();
        return otherId !== vortexOrderId &&
               String(other.created || "") === created &&
               !isAdminManager(otherMgr) &&
               otherMgr !== "Сайт";
      });

      // Strategy 2: Find any non-admin order for the same client on the same day
      if (!pair) {
        pair = clientOrders.find(other => {
          const otherId = String(other.order_id || other.id || "");
          const otherMgr = String(other.manager_name || "").trim();
          return otherId !== vortexOrderId &&
                 !isAdminManager(otherMgr) &&
                 otherMgr !== "Сайт";
        });
      }

      if (pair) {
        const correctManager = String(pair.manager_name || "").trim();
        await db
          .update(orders)
          .set({ managerName: correctManager })
          .where(eq(orders.vortexOrderId, vortexOrderId));
        const strategy = String(pair.created || "") === created ? "same-timestamp" : "same-day";
        console.log(`[Sync] FIX admin manager (${strategy}) for order ${vortexOrderId}: "${managerName}" → "${correctManager}"`);
        if (strategy === "same-timestamp") fixedByPair++;
        else fixedByDayPair++;
      } else {
        console.log(`[Sync] WARN: admin order ${vortexOrderId} (client=${clientId}, manager="${managerName}") has no paired non-admin order`);
      }
    }
  }

  if (fixedByPair + fixedByOverride + fixedByDayPair > 0) {
    console.log(`[Sync] Manager fix summary: ${fixedByPair} by paired EUR order, ${fixedByDayPair} by same-day pair, ${fixedByOverride} by manual override`);
  }
}

/**
 * Main sync function.
 * Accepts either:
 *   - days: number of days back from today (default 3)
 *   - dateFrom / dateTo: explicit Unix timestamps (seconds)
 * Fetches day-by-day with pauses to avoid overloading the Vortex API.
 */
/**
 * Internal sync function for a single chunk.
 * Does NOT manage isSyncing lock — that's handled by syncOrdersChunked.
 */
async function syncOrdersInternal(
  days = 3,
  dateFrom?: string, // YYYY-MM-DD (timezone-safe)
  dateTo?: string,   // YYYY-MM-DD (timezone-safe)
  syncType: "manual" | "auto" = "manual",
  runId?: string,
  chunkIndex?: number,
  autoRetried = false,
  signal?: AbortSignal
): Promise<{ batchId: string; success: boolean; message: string; ordersProcessed?: number; itemsProcessed?: number; newOrders?: number; modifiedOrders?: number }> {
  const batchId = nanoid();
  const db = await getDb();

  if (!db) {
    return { batchId, success: false, message: "Database not available" };
  }

  try {
    let startDate: Date;
    let endDate: Date;

    if (dateFrom !== undefined && dateTo !== undefined) {
      // Parse as UTC midnight to avoid timezone shifts
      startDate = new Date(dateFrom + "T00:00:00.000Z");
      endDate = new Date(dateTo + "T23:59:59.999Z");
    } else {
      // Last N days — use UTC
      const now = new Date();
      endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
      startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1), 0, 0, 0, 0));
    }

    const dateFromStr = startDate.toISOString().slice(0, 10);
    const dateToStr = endDate.toISOString().slice(0, 10);

    // Create sync log entry with date range
    const startedAt = new Date();
    await db.insert(syncLogs).values({
      batchId,
      runId: runId ?? null,
      chunkIndex: chunkIndex ?? null,
      status: "running",
      syncType,
      ordersProcessed: 0,
      itemsProcessed: 0,
      newOrders: 0,
      modifiedOrders: 0,
      deletedOrders: 0,
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      autoRetried,
      startedAt,
    });

    const rangeLabel = `${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)}`;
    console.log(`[Sync] Starting sync: ${rangeLabel}`);

    // Fetch from Vortex API day-by-day with pauses
    const fetchedOrders = await fetchOrdersByDateRange(startDate, endDate, (day, count) => {
      console.log(`[Sync] ${day}: ${count >= 0 ? count + " orders" : "FAILED"}`);
    }, signal);

    console.log(`[Sync] Fetched ${fetchedOrders.length} total valid orders from API`);

    let newCount = 0;
    let modifiedCount = 0;
    let totalItems = 0;

    // Collect webhook data during sync
    const webhookNewOrders: Array<{ vortexOrderId: string; clientName: string; managerName: string; items: number }> = [];
    const webhookModifiedOrders: Array<{ vortexOrderId: string; changes: Array<{ field: string; oldVal: string; newVal: string }> }> = [];

    // Process each fetched order
    for (const rawOrder of fetchedOrders) {
      const vortexOrderId = String(rawOrder.order_id || rawOrder.id || "");
      if (!vortexOrderId) continue;

      // ===== FILTER: skip 'Сайт' manager and 'Архів' status =====
      const rawManagerName = String(rawOrder.manager_name || "").trim();
      const rawOrderStatus = String(rawOrder.status || rawOrder.order_status || "").trim();
      if (
        rawManagerName === "Сайт" ||
        rawOrderStatus === "Архів"
      ) {
        console.log(`[Sync] SKIP order ${vortexOrderId}: manager="${rawManagerName}" status="${rawOrderStatus}"`);
        continue;
      }

      // Check if order exists in DB
      const [existing] = await db
        .select()
        .from(orders)
        .where(eq(orders.vortexOrderId, vortexOrderId))
        .limit(1);

      const orderData = mapOrderToDb(rawOrder);
      const rawItems = (rawOrder.items || []) as Array<Record<string, unknown>>;

      if (!existing) {
        // ===== NEW ORDER =====
        const [insertResult] = await db.insert(orders).values(orderData);
        const orderId = Number(insertResult.insertId);

        // Log as new
        await db.insert(changeLogs).values({
          vortexOrderId,
          changeType: "new",
          fieldName: "order",
          oldValue: null,
          newValue: JSON.stringify({
            clientName: orderData.clientName,
            managerName: orderData.managerName,
            sumUah: orderData.sumUah,
            items: rawItems.length,
          }),
          syncBatchId: batchId,
        });

        // Insert items (skip archived) + fix currency rate
        const orderCreatedTs = rawOrder.created ? Number(rawOrder.created) : null;
        for (const item of rawItems) {
          if (String(item.status || "").trim() === "archived") continue;
          const itemData = mapItemToDb(item, orderId, vortexOrderId);
          const rateInfo = await getFixedRateForItem(itemData.basePriceCurrency, orderCreatedTs);
          await db.insert(orderItems).values({
            ...itemData,
            ...(rateInfo.fixedRate ? { fixedRate: rateInfo.fixedRate, fixedRateDate: rateInfo.fixedRateDate } : {}),
          });
          totalItems++;
        }

        newCount++;
        webhookNewOrders.push({
          vortexOrderId,
          clientName: orderData.clientName || "",
          managerName: orderData.managerName || "",
          items: rawItems.length,
        });
        console.log(`[Sync] NEW order ${vortexOrderId}: ${orderData.clientName}, ${rawItems.length} items`);
      } else {
        // ===== EXISTING ORDER — check for changes =====
        const existingItems = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.vortexOrderId, vortexOrderId));

        const changes = detectChanges(
          existing as unknown as Record<string, unknown>,
          orderData as unknown as Record<string, unknown>,
          existingItems as unknown as Array<Record<string, unknown>>,
          rawItems
        );

        if (changes.length > 0) {
          // Update order
          await db
            .update(orders)
            .set({ ...orderData, updatedAt: new Date() })
            .where(eq(orders.vortexOrderId, vortexOrderId));

          // Log each change
          for (const change of changes) {
            await db.insert(changeLogs).values({
              vortexOrderId,
              changeType: "modified",
              fieldName: change.field,
              oldValue: change.oldVal,
              newValue: change.newVal,
              syncBatchId: batchId,
            });
          }

          // Replace items (skip archived) + preserve/set currency rate
          // First, collect existing fixed rates by orderItemId so we can preserve them
          const existingRates: Record<string, { fixedRate: string | null; fixedRateDate: string | null }> = {};
          for (const ei of existingItems) {
            const eiAny = ei as Record<string, unknown>;
            if (eiAny.fixedRate) {
              existingRates[String(eiAny.orderItemId || "")] = {
                fixedRate: String(eiAny.fixedRate),
                fixedRateDate: eiAny.fixedRateDate ? String(eiAny.fixedRateDate) : null,
              };
            }
          }
          await db.delete(orderItems).where(eq(orderItems.vortexOrderId, vortexOrderId));
          const orderCreatedTsMod = existing.createdTs;
          for (const item of rawItems) {
            if (String(item.status || "").trim() === "archived") continue;
            const itemData = mapItemToDb(item, existing.id, vortexOrderId);
            const itemId = String(item.order_item_id || "");
            // Preserve existing rate if available (immutable)
            const preserved = existingRates[itemId];
            if (preserved?.fixedRate) {
              await db.insert(orderItems).values({
                ...itemData,
                fixedRate: preserved.fixedRate,
                fixedRateDate: preserved.fixedRateDate,
              });
            } else {
              const rateInfo = await getFixedRateForItem(itemData.basePriceCurrency, orderCreatedTsMod ?? null);
              await db.insert(orderItems).values({
                ...itemData,
                ...(rateInfo.fixedRate ? { fixedRate: rateInfo.fixedRate, fixedRateDate: rateInfo.fixedRateDate } : {}),
              });
            }
            totalItems++;
          }

          modifiedCount++;
          webhookModifiedOrders.push({ vortexOrderId, changes });
          console.log(`[Sync] MODIFIED order ${vortexOrderId}: ${changes.length} changes`);
          for (const c of changes) {
            console.log(`  - ${c.field}: "${c.oldVal}" → "${c.newVal}"`);
          }
        } else {
          // No changes — just update syncedAt
          await db
            .update(orders)
            .set({ syncedAt: new Date() })
            .where(eq(orders.vortexOrderId, vortexOrderId));
        }
      }

      // Save snapshot
      await db.insert(orderSnapshots).values({
        vortexOrderId,
        snapshotData: rawOrder,
        syncBatchId: batchId,
      });
    }

    // ===== POST-PROCESSING: Fix admin manager names =====
    // For orders where manager contains 'Адмінка', find paired EUR order
    // from the same client_id + same created timestamp and copy the real manager.
    await fixAdminManagers(db, fetchedOrders);

    // ===== ENRICH WITH RG DATA (supplier info) =====
    // NOTE: Balance enrichment (get_order_by_id) is done separately via enrichBalances()
    let rgEnriched = 0;
    try {
      console.log(`[Sync] Fetching RG (supplier receipt) data...`);
      const rgEntries = await fetchRgByDateRange(startDate, endDate, signal);
      console.log(`[Sync] Got ${rgEntries.length} RG entries, matching to order items...`);

      // ===== RG ENRICHMENT — FIXED: match by order_item_id when available, otherwise by vortexOrderId + code + brand =====
      // Step 1: Build a map of all order_items we just synced, keyed by orderItemId for O(1) lookup
      const syncedOrderIds = new Set<string>();
      for (const rawOrder of fetchedOrders) {
        const vid = String(rawOrder.order_id || rawOrder.id || "");
        if (vid) syncedOrderIds.add(vid);
      }

      // Step 2: Load all order_items for synced orders into memory for precise matching
      const allSyncedItems: Array<{ id: number; vortexOrderId: string; orderItemId: string | null; code: string | null; brandName: string | null; supplierName: string | null; qty: number | null }> = [];
      for (const vid of Array.from(syncedOrderIds)) {
        const items = await db
          .select({
            id: orderItems.id,
            vortexOrderId: orderItems.vortexOrderId,
            orderItemId: orderItems.orderItemId,
            code: orderItems.code,
            brandName: orderItems.brandName,
            supplierName: orderItems.supplierName,
            qty: orderItems.qty,
          })
          .from(orderItems)
          .where(eq(orderItems.vortexOrderId, vid));
        allSyncedItems.push(...items);
      }

      // Step 3: Build lookup indexes
      // Primary: orderItemId -> item (most precise)
      const byOrderItemId = new Map<string, typeof allSyncedItems[number]>();
      // Secondary: vortexOrderId:code:brand -> items[] (for RG entries without order_item_id)
      const byOrderCodeBrand = new Map<string, typeof allSyncedItems>();
      for (const item of allSyncedItems) {
        if (item.orderItemId) {
          byOrderItemId.set(item.orderItemId, item);
        }
        const key = `${item.vortexOrderId}:${(item.code || "").toLowerCase()}:${(item.brandName || "").toLowerCase()}`;
        if (!byOrderCodeBrand.has(key)) byOrderCodeBrand.set(key, []);
        byOrderCodeBrand.get(key)!.push(item);
      }

      // Step 4: Also build a code:brand -> items[] index (cross-order, fallback only)
      const byCodeBrand = new Map<string, typeof allSyncedItems>();
      for (const item of allSyncedItems) {
        const key = `${(item.code || "").toLowerCase()}:${(item.brandName || "").toLowerCase()}`;
        if (!byCodeBrand.has(key)) byCodeBrand.set(key, []);
        byCodeBrand.get(key)!.push(item);
      }

      // Track which item IDs have been enriched this run to avoid double-enrichment
      const enrichedIds = new Set<number>();

      for (const rg of rgEntries) {
        const rgItems = (rg.items || []) as Array<Record<string, unknown>>;
        const supplierName = [rg.sup_name || ""].join("").trim();
        const rgId = String(rg.id || "");
        const rgTimestamp = rg.timestamp ? Number(rg.timestamp) : null;
        const rgCurrency = String(rg.currency || "uah");
        // RG often has an order_id that links to vortexOrderId
        const rgOrderId = String(rg.order_id || rg.or_id || "");

        for (const rgItem of rgItems) {
          const artId = String(rgItem.art_id || "");
          const code = String(rgItem.code || "");
          const brand = String(rgItem.brand || "");
          const rgItemOrderItemId = String(rgItem.order_item_id || rgItem.item_id || "");
          const supplierTotal = rgItem.price ? String(rgItem.price) : null;
          const rgQty = rgItem.qty ? Number(rgItem.qty) : null;

          if (!artId && !code) continue;

          let matched: typeof allSyncedItems[number] | undefined;

          // Strategy 1: Match by order_item_id (most precise — unique per line)
          if (rgItemOrderItemId && byOrderItemId.has(rgItemOrderItemId)) {
            const candidate = byOrderItemId.get(rgItemOrderItemId)!;
            if (!candidate.supplierName && !enrichedIds.has(candidate.id)) {
              matched = candidate;
            }
          }

          // Strategy 2: Match by RG's order_id + code + brand (scoped to one order)
          if (!matched && rgOrderId) {
            const key = `${rgOrderId}:${code.toLowerCase()}:${brand.toLowerCase()}`;
            const candidates = byOrderCodeBrand.get(key) || [];
            // If multiple items with same code+brand in one order, prefer matching qty
            if (rgQty != null) {
              matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id) && c.qty === rgQty);
            }
            if (!matched) {
              matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id));
            }
          }

          // Strategy 3: Fallback — match by code + brand across all synced orders (least precise)
          if (!matched) {
            const key = `${code.toLowerCase()}:${brand.toLowerCase()}`;
            const candidates = byCodeBrand.get(key) || [];
            if (rgQty != null) {
              matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id) && c.qty === rgQty);
            }
            if (!matched) {
              matched = candidates.find(c => !c.supplierName && !enrichedIds.has(c.id));
            }
          }

          if (matched) {
            await db
              .update(orderItems)
              .set({
                supplierName,
                supplierTotal,
                supplierCurrency: rgCurrency,
                rgId,
                rgTimestamp,
              })
              .where(eq(orderItems.id, matched.id));
            enrichedIds.add(matched.id);
            // Mark as enriched in memory too
            matched.supplierName = supplierName;
            rgEnriched++;
          }
        }
      }
      console.log(`[Sync] Enriched ${rgEnriched} items with supplier data`);
    } catch (rgError) {
      console.error(`[Sync] RG enrichment failed (non-critical):`, rgError);
    }

    // Update sync log
    await db
      .update(syncLogs)
      .set({
        status: "completed",
        ordersProcessed: fetchedOrders.length,
        itemsProcessed: totalItems,
        newOrders: newCount,
        modifiedOrders: modifiedCount,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.batchId, batchId));

    const msg = `Synced ${fetchedOrders.length} orders (${newCount} new, ${modifiedCount} modified, ${rgEnriched} items enriched with supplier data)`;
    console.log(`[Sync] Completed: ${msg}`);

    // Fire webhooks for all changes (non-blocking)
    if (webhookNewOrders.length > 0 || webhookModifiedOrders.length > 0) {
      console.log(`[Sync] Firing webhooks: ${webhookNewOrders.length} new, ${webhookModifiedOrders.length} modified`);
      fireSyncWebhooks({
        batchId,
        newOrders: webhookNewOrders,
        modifiedOrders: webhookModifiedOrders,
      }).catch((err) => {
        console.error(`[Sync] Webhook delivery error:`, err);
      });
    }

    return {
      batchId,
      success: true,
      message: msg,
      ordersProcessed: fetchedOrders.length,
      itemsProcessed: totalItems,
      newOrders: newCount,
      modifiedOrders: modifiedCount,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Sync] Failed:`, errMsg);

    await db
      .update(syncLogs)
      .set({
        status: "failed",
        errorMessage: errMsg,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.batchId, batchId));

    return { batchId, success: false, message: errMsg, ordersProcessed: 0, itemsProcessed: 0, newOrders: 0, modifiedOrders: 0 };
  }
}

/**
 * Public wrapper: sync with isSyncing lock (for standalone calls, not used by chunked sync).
 */
export async function syncOrders(
  days = 3,
  dateFrom?: string, // YYYY-MM-DD
  dateTo?: string,   // YYYY-MM-DD
  syncType: "manual" | "auto" = "manual"
): Promise<{ batchId: string; success: boolean; message: string }> {
  if (isSyncing) {
    return { batchId: "", success: false, message: "Sync already in progress" };
  }
  isSyncing = true;
  try {
    return await syncOrdersInternal(days, dateFrom, dateTo, syncType);
  } finally {
    isSyncing = false;
  }
}

// Scheduled sync - runs daily at 02:00 Kyiv time (UTC+3)
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Returns milliseconds until next 02:00 Kyiv time (UTC+3).
 */
function msUntil2amKyiv(): number {
  const now = new Date();
  // Kyiv is UTC+3
  const kyivOffset = 3 * 60 * 60 * 1000;
  const kyivNow = new Date(now.getTime() + kyivOffset);
  // Next 02:00 Kyiv = 02:00 UTC+3 = 23:00 UTC previous day
  const next2am = new Date(kyivNow);
  next2am.setUTCHours(2, 0, 0, 0); // 02:00 in Kyiv local = UTC+3 offset applied
  // If 02:00 today has already passed, move to tomorrow
  if (next2am.getTime() <= kyivNow.getTime()) {
    next2am.setUTCDate(next2am.getUTCDate() + 1);
  }
  return next2am.getTime() - kyivNow.getTime();
}

export function startScheduledSync() {
  if (syncTimeout) return;

  const scheduleNext = () => {
    const delay = msUntil2amKyiv();
    const nextRun = new Date(Date.now() + delay);
    console.log(`[Sync] Next auto-sync scheduled at ${nextRun.toISOString()} (Kyiv 02:00)`);
    syncTimeout = setTimeout(async () => {
      syncTimeout = null;
      console.log("[Sync] Auto daily sync triggered (02:00 Kyiv)");
      try {
        // Sync last 30 days: from today-30 to today (Kyiv time)
        const nowKyiv = new Date(Date.now() + 3 * 60 * 60 * 1000); // UTC+3
        const todayStr = nowKyiv.toISOString().slice(0, 10);
        const thirtyDaysAgo = new Date(nowKyiv);
        thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
        const fromStr = thirtyDaysAgo.toISOString().slice(0, 10);
        console.log(`[Sync] Auto-sync: last 30 days ${fromStr} — ${todayStr}`);
        await syncOrdersChunked(0, fromStr, todayStr, "auto"); // sync last 30 days via chunks
      } catch (error) {
        console.error("[Sync] Auto sync error:", error);
      }
      // Schedule next day
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

export function stopScheduledSync() {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
    console.log("[Sync] Scheduled sync stopped");
  }
}

/**
 * Returns the next scheduled auto-sync time as ISO string, or null if not scheduled.
 */
export function getNextScheduledSyncTime(): string | null {
  if (!syncTimeout) return null;
  const delay = msUntil2amKyiv();
  return new Date(Date.now() + delay).toISOString();
}

/**
 * Separate balance enrichment: fetches get_order_by_id for orders that have no balance yet.
 * Runs independently from syncOrders to avoid blocking normal syncs.
 * @param limit max number of orders to enrich in one run (default 200)
 */
let isEnrichingBalances = false;

export async function enrichBalances(limit = 200): Promise<{ success: boolean; message: string; enriched: number }> {
  if (isEnrichingBalances) {
    return { success: false, message: "Balance enrichment already in progress", enriched: 0 };
  }
  isEnrichingBalances = true;
  const db = await getDb();
  if (!db) {
    isEnrichingBalances = false;
    return { success: false, message: "Database not available", enriched: 0 };
  }

  try {
    // Find orders without balance data
    const toEnrich = await db
      .select({ id: orders.id, vortexOrderId: orders.vortexOrderId })
      .from(orders)
      .where(isNull(orders.balanceCurrencyTotal))
      .limit(limit);

    console.log(`[Balance] Found ${toEnrich.length} orders without balance data (limit ${limit})`);
    let enriched = 0;

    for (let i = 0; i < toEnrich.length; i++) {
      const { vortexOrderId } = toEnrich[i];
      try {
        const detail = await getOrderById(vortexOrderId);
        if (detail && typeof detail === "object") {
          const balanceCurrencyTotal = detail.balance_currency_total != null ? String(detail.balance_currency_total) : null;
          const balanceCurrency = detail.balance_currency ? String(detail.balance_currency) : null;
          if (balanceCurrencyTotal !== null || balanceCurrency !== null) {
            await db
              .update(orders)
              .set({ balanceCurrencyTotal, balanceCurrency })
              .where(eq(orders.vortexOrderId, vortexOrderId));
            enriched++;
          }
        }
      } catch (err) {
        console.warn(`[Balance] Failed for ${vortexOrderId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // 2s pause between requests
      if (i < toEnrich.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const msg = `Збагачено балансами ${enriched} з ${toEnrich.length} замовлень`;
    console.log(`[Balance] ${msg}`);
    isEnrichingBalances = false;
    return { success: true, message: msg, enriched };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Balance] Failed:`, errMsg);
    isEnrichingBalances = false;
    return { success: false, message: errMsg, enriched: 0 };
  }
}

export function getIsEnrichingBalances() {
  return isEnrichingBalances;
}

/**
 * On server startup, reset any sync logs stuck in 'running' state
 * (from a previous server instance that was killed mid-sync).
 */
export async function resetStaleSyncLogs(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { eq } = await import("drizzle-orm");
  const staleResult = await db
    .update(syncLogs)
    .set({
      status: "failed",
      errorMessage: "Server restarted while sync was running",
      completedAt: new Date(),
    })
    .where(eq(syncLogs.status, "running"));

  // Reset the in-memory flag too
  isSyncing = false;

  const affected = (staleResult as unknown as { affectedRows?: number }[])?.[0]?.affectedRows ?? 0;
  if (affected > 0) {
    console.log(`[Startup] Reset ${affected} stale sync log(s) from 'running' to 'failed'`);
  }
}

/**
 * On server startup, resume any incomplete sync runs.
 * A run is incomplete if it has status='running' or if it has uncompleted chunks.
 */
export async function resumeIncompleteSync(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { eq, and } = await import("drizzle-orm");

  // Find all runs that are still 'running' (should have been reset to 'failed' by now, but check anyway)
  const runningRuns = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"))
    .limit(10);

  if (runningRuns.length === 0) {
    return; // No incomplete runs
  }

  console.log(`[Startup] Found ${runningRuns.length} incomplete sync run(s), attempting to resume...`);

  for (const run of runningRuns) {
    try {
      if (!run.dateFrom || !run.dateTo) {
        console.warn(`[Startup] Skipping run ${run.runId}: missing date range`);
        continue;
      }

      // Get all chunks for this run
      const chunks = await db
        .select()
        .from(syncLogs)
        .where(eq(syncLogs.runId, run.runId));

      if (chunks.length === 0) {
        console.warn(`[Startup] Skipping run ${run.runId}: no chunks found`);
        continue;
      }

      // Find the latest record per chunkIndex
      const latestByIndex = new Map<number, typeof chunks[0]>();
      for (const c of chunks) {
        const idx = c.chunkIndex ?? 0;
        const existing = latestByIndex.get(idx);
        if (!existing || (c.startedAt && existing.startedAt && new Date(c.startedAt) > new Date(existing.startedAt))) {
          latestByIndex.set(idx, c);
        }
      }

      // Check if all chunks are completed
      const allCompleted = Array.from(latestByIndex.values()).every(c => c.status === "completed");
      if (allCompleted) {
        // Mark run as completed
        await db.update(syncRuns).set({ status: "completed", completedAt: new Date() }).where(eq(syncRuns.runId, run.runId));
        console.log(`[Startup] Run ${run.runId} all chunks completed, marking as done`);
        continue;
      }

      // Find chunks that need to be executed (failed, cancelled, or never created)
      const startDate = new Date(run.dateFrom + "T00:00:00.000Z");
      const endDate = new Date(run.dateTo + "T23:59:59.999Z");
      const allPlannedChunks = splitIntoChunks(startDate, endDate);

      const chunksToRun: Array<{ index: number; from: Date; to: Date }> = [];
      for (let i = 0; i < allPlannedChunks.length; i++) {
        const chunkIdx = i + 1; // 1-based
        const latest = latestByIndex.get(chunkIdx);
        if (!latest) {
          // Never created
          chunksToRun.push({ index: chunkIdx, from: allPlannedChunks[i].from, to: allPlannedChunks[i].to });
        } else if (latest.status === "failed" || latest.status === "cancelled") {
          // Failed or cancelled — re-execute
          chunksToRun.push({ index: chunkIdx, from: allPlannedChunks[i].from, to: allPlannedChunks[i].to });
        }
        // If 'completed' or 'running' — skip
      }

      if (chunksToRun.length === 0) {
        console.log(`[Startup] Run ${run.runId} has no incomplete chunks, marking as completed`);
        await db.update(syncRuns).set({ status: "completed", completedAt: new Date() }).where(eq(syncRuns.runId, run.runId));
        continue;
      }

      console.log(`[Startup] Resuming run ${run.runId} with ${chunksToRun.length}/${allPlannedChunks.length} incomplete chunks`);

      // Resume execution
      isSyncing = true;
      for (const chunk of chunksToRun) {
        if (cancelRequested) break;
        const chunkLabel = `${chunk.from.toISOString().slice(0, 10)} — ${chunk.to.toISOString().slice(0, 10)}`;
        console.log(`[Startup] Resuming chunk ${chunk.index}/${allPlannedChunks.length}: ${chunkLabel}`);
        await syncChunkWithRetry(chunk.from, chunk.to, run.syncType, 0, run.runId, chunk.index);
        await updateRunStats(run.runId);
        // Small pause between chunks
        await new Promise(r => setTimeout(r, 3000));
      }
      isSyncing = false;

      // Final update
      await updateRunStats(run.runId);
      console.log(`[Startup] Resumed run ${run.runId} completed`);
    } catch (error) {
      console.error(`[Startup] Error resuming run ${run.runId}:`, error);
    }
  }
}

/**
 * Helper: split date range into chunks (used by both sync and resume logic).
 */
export function splitIntoChunksForResume(startDate: Date, endDate: Date): Array<{ from: Date; to: Date }> {
  return splitIntoChunks(startDate, endDate);
}

const CHUNK_SIZE_DAYS = 7;
const CHUNK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes hard timeout per chunk

/**
 * Split a date range into 7-day chunks.
 * Returns array of { from: Date, to: Date } pairs.
 */
function splitIntoChunks(startDate: Date, endDate: Date): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_SIZE_DAYS - 1);
    // Don't go past endDate
    const actualEnd = chunkEnd > endDate ? new Date(endDate) : chunkEnd;

    chunks.push({
      from: new Date(current),
      to: new Date(actualEnd),
    });

    // Move to next chunk
    current.setDate(current.getDate() + CHUNK_SIZE_DAYS);
  }

  return chunks;
}

/**
 * Recursively sync a date range, splitting into halves on failure.
 * Minimum granularity: 1 day. Each attempt creates its own sync_log entry.
 * Returns array of results (may be multiple sub-chunks if splitting occurred).
 */
const MAX_AUTO_RETRIES = 3;

async function syncChunkWithRetry(
  from: Date,
  to: Date,
  syncType: "manual" | "auto",
  depth = 0,
  runId?: string,
  chunkIndex?: number,
  retryAttempt = 0
): Promise<Array<{ batchId: string; success: boolean; dateFrom: string; dateTo: string; ordersProcessed?: number; itemsProcessed?: number; newOrders?: number; modifiedOrders?: number }>> {
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const totalDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const indent = "  ".repeat(depth);

  console.log(`${indent}[ChunkRetry] Trying ${fromStr} — ${toStr} (${totalDays} days, depth=${depth}, attempt=${retryAttempt}/${MAX_AUTO_RETRIES})`);

  // Create AbortController for this chunk — shared by ALL HTTP requests inside syncOrdersInternal.
  // When the 15-minute timer fires, controller.abort() immediately destroys every active socket.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    console.error(`${indent}[ChunkRetry] ⏰ HARD TIMEOUT: aborting chunk ${fromStr} — ${toStr} after ${CHUNK_TIMEOUT_MS / 60000} minutes`);
    controller.abort();
  }, CHUNK_TIMEOUT_MS);

  let result: { batchId: string; success: boolean; message: string; ordersProcessed?: number; itemsProcessed?: number; newOrders?: number; modifiedOrders?: number };
  try {
    result = await syncOrdersInternal(0, fromStr, toStr, syncType, runId, chunkIndex, retryAttempt > 0, controller.signal);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.includes("AbortError") || controller.signal.aborted;
    const displayMsg = isTimeout ? `Chunk timeout: exceeded ${CHUNK_TIMEOUT_MS / 60000} minutes` : errMsg;
    result = { batchId: `err-${nanoid(6)}`, success: false, message: displayMsg };

    if (isTimeout) {
      console.error(`${indent}[ChunkRetry] ⏰ TIMEOUT confirmed: ${fromStr} — ${toStr}`);
      // Try to mark the running sync_log for this chunk as failed
      try {
        const dbTimeout = await getDb();
        if (dbTimeout && runId) {
          const runningLogs = await dbTimeout.select().from(syncLogs)
            .where(and(eq(syncLogs.runId, runId), eq(syncLogs.status, "running")));
          for (const log of runningLogs) {
            if (log.chunkIndex === chunkIndex) {
              await dbTimeout.update(syncLogs).set({
                status: "failed",
                errorMessage: `Timeout: exceeded ${CHUNK_TIMEOUT_MS / 60000} minutes`,
                completedAt: new Date(),
              }).where(eq(syncLogs.batchId, log.batchId));
              result.batchId = log.batchId;
            }
          }
        }
      } catch (dbErr) {
        console.error(`${indent}[ChunkRetry] Failed to mark timed-out chunk in DB:`, dbErr);
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (result.success) {
    console.log(`${indent}[ChunkRetry] ✅ Success: ${fromStr} — ${toStr}${retryAttempt > 0 ? ` (after ${retryAttempt} retries)` : ""}`);
    return [{ batchId: result.batchId, success: true, dateFrom: fromStr, dateTo: toStr, ordersProcessed: result.ordersProcessed, itemsProcessed: result.itemsProcessed, newOrders: result.newOrders, modifiedOrders: result.modifiedOrders }];
  }

  // Failed at depth=0 and still have auto-retry attempts left: retry up to MAX_AUTO_RETRIES times
  if (depth === 0 && retryAttempt < MAX_AUTO_RETRIES) {
    const nextAttempt = retryAttempt + 1;
    const pauseSec = nextAttempt * 3; // 3s, 6s, 9s progressive backoff
    console.warn(`${indent}[ChunkRetry] ⚠️ Auto-retry ${nextAttempt}/${MAX_AUTO_RETRIES}: ${fromStr} — ${toStr} (pause ${pauseSec}s)`);
    await new Promise(r => setTimeout(r, pauseSec * 1000));
    return syncChunkWithRetry(from, to, syncType, depth, runId, chunkIndex, nextAttempt);
  }

  // Failed — can we split further?
  if (totalDays <= 1) {
    // Minimum granularity reached — mark as failed
    console.error(`${indent}[ChunkRetry] ❌ Failed at 1-day granularity: ${fromStr}`);
    return [{ batchId: result.batchId, success: false, dateFrom: fromStr, dateTo: toStr }];
  }

  // Split into two halves
  const midDays = Math.floor(totalDays / 2);
  const mid = new Date(from);
  mid.setDate(mid.getDate() + midDays - 1);
  mid.setHours(23, 59, 59, 999);
  const midNext = new Date(mid);
  midNext.setDate(midNext.getDate() + 1);
  midNext.setHours(0, 0, 0, 0);

  console.log(`${indent}[ChunkRetry] Splitting ${fromStr}—${toStr} into [${fromStr}—${mid.toISOString().slice(0,10)}] + [${midNext.toISOString().slice(0,10)}—${toStr}]`);

  const leftResults = await syncChunkWithRetry(from, mid, syncType, depth + 1, runId, chunkIndex);
  // Small pause between sub-chunks
  await new Promise(r => setTimeout(r, 2000));
  const rightResults = await syncChunkWithRetry(midNext, to, syncType, depth + 1, runId, chunkIndex);

  return [...leftResults, ...rightResults];
}

/**
 * Chunked sync: splits large periods into 7-day chunks and executes them sequentially.
 * Each chunk creates its own sync_log entry with dateFrom/dateTo.
 * Used for both manual sync and nightly auto-sync.
 */
export async function syncOrdersChunked(
  days = 3,
  dateFrom?: string, // YYYY-MM-DD (timezone-safe)
  dateTo?: string,   // YYYY-MM-DD (timezone-safe)
  syncType: "manual" | "auto" = "manual"
): Promise<{ success: boolean; message: string; chunks: number; results: Array<{ batchId: string; success: boolean; dateFrom: string; dateTo: string }> }> {
  // BUG FIX #3: isSyncing lock at chunked level (not per-chunk)
  if (isSyncing) {
    return { success: false, message: "Sync already in progress", chunks: 0, results: [] };
  }
  isSyncing = true;

  try {
    return await _syncOrdersChunkedInner(days, dateFrom, dateTo, syncType);
  } finally {
    isSyncing = false;
    cancelRequested = false;
  }
}

/**
 * Cancel a specific running chunk by batchId.
 * Marks the chunk as cancelled in DB and sets the global cancelRequested flag
 * so the parent run also stops after this chunk.
 */
export async function cancelChunk(batchId: string): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) return { success: false, message: "Database not available" };

  const { eq } = await import("drizzle-orm");
  const [chunk] = await db.select().from(syncLogs).where(eq(syncLogs.batchId, batchId)).limit(1);
  if (!chunk) return { success: false, message: "Chunk not found" };
  if (chunk.status !== "running") return { success: false, message: `Chunk is not running (status: ${chunk.status})` };

  // Mark chunk as cancelled
  await db.update(syncLogs).set({
    status: "cancelled",
    errorMessage: "Cancelled by user",
    completedAt: new Date(),
  }).where(eq(syncLogs.batchId, batchId));

  // Also request global cancel so parent run stops
  cancelRequested = true;

  console.log(`[Sync] Chunk ${batchId} cancelled by user`);
  return { success: true, message: "Chunk cancelled. Parent run will stop after current chunk." };
}

/**
 * Retry a specific failed or cancelled chunk by batchId.
 * After successful retry, continues executing any remaining chunks in the parent run.
 * Can be called even when no sync is currently running.
 */
export async function retryChunk(batchId: string): Promise<{ success: boolean; message: string; newBatchId?: string }> {
  const db = await getDb();
  if (!db) return { success: false, message: "Database not available" };

  const { eq } = await import("drizzle-orm");
  const [chunk] = await db.select().from(syncLogs).where(eq(syncLogs.batchId, batchId)).limit(1);
  if (!chunk) return { success: false, message: "Chunk not found" };
  if (chunk.status !== "failed" && chunk.status !== "cancelled") {
    return { success: false, message: `Can only retry failed or cancelled chunks (status: ${chunk.status})` };
  }
  if (!chunk.dateFrom || !chunk.dateTo) {
    return { success: false, message: "Chunk has no date range to retry" };
  }

  if (isSyncing) {
    return { success: false, message: "Another sync is already running. Please wait." };
  }

  console.log(`[Sync] Manual retry of chunk ${batchId}: ${chunk.dateFrom} — ${chunk.dateTo}`);

  // Run in background (fire-and-forget), using the same runId if available
  isSyncing = true;
  cancelRequested = false;
  (async () => {
    try {
      // 1. Retry the failed chunk itself
      const retryResult = await syncOrdersInternal(0, chunk.dateFrom ?? undefined, chunk.dateTo ?? undefined, chunk.syncType ?? "manual", chunk.runId ?? undefined, chunk.chunkIndex ?? undefined, false);

      // 2. After successful retry, continue remaining chunks in the parent run
      if (retryResult.success && chunk.runId) {
        await continueRemainingChunks(chunk.runId, chunk.chunkIndex ?? 0, chunk.syncType ?? "manual");
      }

      // 3. Update parent run stats
      if (chunk.runId) {
        await updateRunStats(chunk.runId);
      }
    } catch (err) {
      console.error(`[Sync] Retry chunk ${batchId} failed:`, err);
    } finally {
      isSyncing = false;
      cancelRequested = false;
    }
  })();

  return { success: true, message: `Retry started for ${chunk.dateFrom} — ${chunk.dateTo}. Remaining chunks will continue automatically.` };
}

/**
 * After a successful retry, continue executing any remaining chunks
 * that were never created (e.g., server restart killed the for-loop).
 */
async function continueRemainingChunks(
  runId: string,
  retriedChunkIndex: number,
  syncType: "manual" | "auto"
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Get the parent run to know the full date range and total planned chunks
  const [run] = await db.select().from(syncRuns).where(eq(syncRuns.runId, runId)).limit(1);
  if (!run || !run.dateFrom || !run.dateTo) return;

  // Recalculate ALL planned chunks from the run's full date range
  const startDate = new Date(run.dateFrom + "T00:00:00.000Z");
  const endDate = new Date(run.dateTo + "T23:59:59.999Z");
  const allPlannedChunks = splitIntoChunks(startDate, endDate);

  // Get all existing chunk records for this run
  const existingLogs = await db.select().from(syncLogs).where(eq(syncLogs.runId, runId));

  // Find the latest record per chunkIndex
  const latestByIndex = new Map<number, typeof existingLogs[0]>();
  for (const c of existingLogs) {
    const idx = c.chunkIndex ?? 0;
    const existing = latestByIndex.get(idx);
    if (!existing || (c.startedAt && existing.startedAt && new Date(c.startedAt) > new Date(existing.startedAt))) {
      latestByIndex.set(idx, c);
    }
  }

  // Find chunks that need to be executed (never created, or latest is failed/cancelled)
  const chunksToRun: Array<{ index: number; from: Date; to: Date }> = [];
  for (let i = 0; i < allPlannedChunks.length; i++) {
    const chunkIdx = i + 1; // 1-based
    if (chunkIdx <= retriedChunkIndex) continue; // Skip already-done chunks (including the just-retried one)

    const latest = latestByIndex.get(chunkIdx);
    if (!latest) {
      // Never created — needs execution
      chunksToRun.push({ index: chunkIdx, from: allPlannedChunks[i].from, to: allPlannedChunks[i].to });
    } else if (latest.status === "cancelled" || latest.status === "failed") {
      // Was cancelled or failed — re-execute
      chunksToRun.push({ index: chunkIdx, from: allPlannedChunks[i].from, to: allPlannedChunks[i].to });
    }
    // If latest is "completed" — skip (already done)
    // If latest is "running" — skip (still in progress)
  }

  if (chunksToRun.length === 0) {
    console.log(`[Sync] No remaining chunks to continue for run ${runId}`);
    return;
  }

  console.log(`[Sync] Continuing ${chunksToRun.length} remaining chunks for run ${runId}`);

  // Update run status back to running
  await db.update(syncRuns).set({ status: "running" }).where(eq(syncRuns.runId, runId));

  for (const chunk of chunksToRun) {
    if (cancelRequested) {
      console.log(`[Sync] Cancellation requested during continuation — stopping.`);
      break;
    }

    const chunkLabel = `${chunk.from.toISOString().slice(0, 10)} — ${chunk.to.toISOString().slice(0, 10)}`;
    console.log(`[Sync] Continuing chunk ${chunk.index}/${allPlannedChunks.length}: ${chunkLabel}`);

    const subResults = await syncChunkWithRetry(chunk.from, chunk.to, syncType, 0, runId, chunk.index);

    // Update run progress
    await updateRunStats(runId);

    // Small pause between chunks
    if (!cancelRequested) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

/**
 * Recalculate and update parent run stats from all its chunk records.
 */
async function updateRunStats(runId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const allChunks = await db.select().from(syncLogs).where(eq(syncLogs.runId, runId));

  // Use only the LATEST record per chunkIndex
  const latestByIndex = new Map<number, typeof allChunks[0]>();
  for (const c of allChunks) {
    const idx = c.chunkIndex ?? 0;
    const existing = latestByIndex.get(idx);
    if (!existing || (c.startedAt && existing.startedAt && new Date(c.startedAt) > new Date(existing.startedAt))) {
      latestByIndex.set(idx, c);
    }
  }
  const latestChunks = Array.from(latestByIndex.values());
  const completedChunks = latestChunks.filter(c => c.status === "completed").length;
  const failedChunks = latestChunks.filter(c => c.status === "failed").length;
  const cancelledChunks = latestChunks.filter(c => c.status === "cancelled").length;
  const runningChunks = latestChunks.filter(c => c.status === "running").length;

  // Sum stats from ALL completed chunks
  const completedAll = allChunks.filter(c => c.status === "completed");
  const totalOrders = completedAll.reduce((s, c) => s + (c.ordersProcessed ?? 0), 0);
  const totalNew = completedAll.reduce((s, c) => s + (c.newOrders ?? 0), 0);
  const totalMod = completedAll.reduce((s, c) => s + (c.modifiedOrders ?? 0), 0);

  const allDone = runningChunks === 0;
  const finalStatus = !allDone ? "running" : failedChunks > 0 ? "failed" : cancelledChunks > 0 ? "cancelled" : "completed";

  await db.update(syncRuns).set({
    completedChunks,
    failedChunks,
    cancelledChunks,
    ordersProcessed: totalOrders,
    newOrders: totalNew,
    modifiedOrders: totalMod,
    ...(allDone ? { status: finalStatus, completedAt: new Date() } : { status: finalStatus }),
  }).where(eq(syncRuns.runId, runId));
}

async function _syncOrdersChunkedInner(
  days: number,
  dateFrom: string | undefined, // YYYY-MM-DD
  dateTo: string | undefined,   // YYYY-MM-DD
  syncType: "manual" | "auto"
): Promise<{ success: boolean; message: string; chunks: number; runId: string; results: Array<{ batchId: string; success: boolean; dateFrom: string; dateTo: string }> }> {
  // Calculate full date range
  let startDate: Date;
  let endDate: Date;

  if (dateFrom !== undefined && dateTo !== undefined) {
    // Parse as UTC midnight to avoid timezone shifts
    startDate = new Date(dateFrom + "T00:00:00.000Z");
    endDate = new Date(dateTo + "T23:59:59.999Z");
  } else {
    // Last N days — use UTC to be consistent
    const now = new Date();
    endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1), 0, 0, 0, 0));
  }

  // Split into 7-day chunks
  const chunks = splitIntoChunks(startDate, endDate);
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  console.log(`[ChunkedSync] Period: ${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)} (${totalDays} days, ${chunks.length} chunks)`);

  // Create parent sync_run record
  const runId = nanoid();
  const db = await getDb();
  if (db) {
    await db.insert(syncRuns).values({
      runId,
      status: "running",
      syncType,
      dateFrom: startDate.toISOString().slice(0, 10),
      dateTo: endDate.toISOString().slice(0, 10),
      totalChunks: chunks.length,
      completedChunks: 0,
      failedChunks: 0,
      cancelledChunks: 0,
      ordersProcessed: 0,
      itemsProcessed: 0,
      newOrders: 0,
      modifiedOrders: 0,
      startedAt: new Date(),
    });
  }

  const results: Array<{ batchId: string; success: boolean; dateFrom: string; dateTo: string; ordersProcessed?: number; itemsProcessed?: number; newOrders?: number; modifiedOrders?: number }> = [];

  // Reset cancel flag at start of new chunked run
  cancelRequested = false;

  // Execute chunks sequentially
  for (let i = 0; i < chunks.length; i++) {
    // Check cancellation BEFORE starting next chunk
    if (cancelRequested) {
      console.log(`[ChunkedSync] Cancellation detected before chunk ${i + 1}/${chunks.length} — stopping.`);
      // Log remaining chunks as cancelled in DB
      const dbInner = await getDb();
      if (dbInner) {
        for (let j = i; j < chunks.length; j++) {
          const cancelBatchId = nanoid();
          const cancelChunk = chunks[j];
          await dbInner.insert(syncLogs).values({
            batchId: cancelBatchId,
            runId,
            chunkIndex: j + 1,
            status: "cancelled",
            syncType,
            ordersProcessed: 0,
            itemsProcessed: 0,
            newOrders: 0,
            modifiedOrders: 0,
            deletedOrders: 0,
            dateFrom: cancelChunk.from.toISOString().slice(0, 10),
            dateTo: cancelChunk.to.toISOString().slice(0, 10),
            startedAt: new Date(),
            completedAt: new Date(),
            errorMessage: "Cancelled by user",
          });
          results.push({
            batchId: cancelBatchId,
            success: false,
            dateFrom: cancelChunk.from.toISOString().slice(0, 10),
            dateTo: cancelChunk.to.toISOString().slice(0, 10),
          });
        }
      }
      break;
    }

    const chunk = chunks[i];
    const chunkLabel = `${chunk.from.toISOString().slice(0, 10)} — ${chunk.to.toISOString().slice(0, 10)}`;
    console.log(`[ChunkedSync] Starting chunk ${i + 1}/${chunks.length}: ${chunkLabel}`);

    // Recursive retry with sub-splitting on failure — pass runId and chunkIndex
    const subResults = await syncChunkWithRetry(chunk.from, chunk.to, syncType, 0, runId, i + 1);
    results.push(...subResults);

    // Update run progress after each chunk
    const dbProgress = await getDb();
    if (dbProgress) {
      const completedSoFar = results.filter(r => r.success).length;
      const failedSoFar = results.filter(r => !r.success).length;
      const totalOrders = results.reduce((s, r) => s + (r.ordersProcessed ?? 0), 0);
      const totalItems = results.reduce((s, r) => s + (r.itemsProcessed ?? 0), 0);
      const totalNew = results.reduce((s, r) => s + (r.newOrders ?? 0), 0);
      const totalMod = results.reduce((s, r) => s + (r.modifiedOrders ?? 0), 0);
      await dbProgress.update(syncRuns).set({
        completedChunks: completedSoFar,
        failedChunks: failedSoFar,
        ordersProcessed: totalOrders,
        itemsProcessed: totalItems,
        newOrders: totalNew,
        modifiedOrders: totalMod,
      }).where(eq(syncRuns.runId, runId));
    }

    // Small pause between chunks to avoid overloading
    if (i < chunks.length - 1 && !cancelRequested) {
      console.log(`[ChunkedSync] Pausing 3s before next chunk...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const cancelCount = results.filter(r => !r.success && results.length < chunks.length).length;
  const msg = `Chunked sync completed: ${successCount}/${chunks.length} chunks successful${failCount > 0 ? `, ${failCount} failed` : ""}`;
  console.log(`[ChunkedSync] ${msg}`);

  // Determine final run status
  const wasCancelled = cancelRequested;
  const finalStatus = wasCancelled ? "cancelled" : failCount > 0 ? "failed" : "completed";

  // Coverage validation: check if all planned date ranges were covered
  let coverageWarning: string | null = null;
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length < chunks.length) {
    const coveredRanges = successfulResults.map(r => `${r.dateFrom} — ${r.dateTo}`);
    const allRanges = chunks.map(c => `${c.from.toISOString().slice(0, 10)} — ${c.to.toISOString().slice(0, 10)}`);
    const missingRanges = allRanges.filter(r => !coveredRanges.includes(r));
    if (missingRanges.length > 0) {
      coverageWarning = `Не покрито ${missingRanges.length} діапазон(ів): ${missingRanges.join(", ")}`;
      console.warn(`[ChunkedSync] ⚠️ Coverage warning: ${coverageWarning}`);
    }
  }

  // Update parent run with final stats
  const dbFinal = await getDb();
  if (dbFinal) {
    const totalOrders = results.reduce((s, r) => s + (r.ordersProcessed ?? 0), 0);
    const totalItems = results.reduce((s, r) => s + (r.itemsProcessed ?? 0), 0);
    const totalNew = results.reduce((s, r) => s + (r.newOrders ?? 0), 0);
    const totalMod = results.reduce((s, r) => s + (r.modifiedOrders ?? 0), 0);
    await dbFinal.update(syncRuns).set({
      status: finalStatus,
      completedChunks: successCount,
      failedChunks: failCount,
      cancelledChunks: cancelCount,
      ordersProcessed: totalOrders,
      itemsProcessed: totalItems,
      newOrders: totalNew,
      modifiedOrders: totalMod,
      completedAt: new Date(),
      coverageWarning,
    }).where(eq(syncRuns.runId, runId));
  }

  return {
    success: failCount === 0 && !wasCancelled,
    message: msg + (coverageWarning ? ` | ${coverageWarning}` : ""),
    chunks: chunks.length,
    runId,
    results,
  };
}
