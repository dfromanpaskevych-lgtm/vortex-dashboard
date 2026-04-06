import { eq, desc, and, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { orders, orderItems, orderSnapshots, changeLogs, syncLogs } from "../drizzle/schema";
import { fetchOrdersByDateRange, fetchRgByDateRange, getOrderById } from "./vortexClient";
import { nanoid } from "nanoid";
import { fireSyncWebhooks } from "./webhookService";
import { getExchangeRate, timestampToDateStr } from "./currencyService";

let isSyncing = false;

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
    customerPhone: deliveryData?.customer_phone ? String(deliveryData.customer_phone) : null,
    trackNumber: deliveryData?.track_number ? String(deliveryData.track_number) : null,
    cityName: deliveryData?.city_name ? String(deliveryData.city_name) : null,
    instanceName: deliveryData?.instance_name ? String(deliveryData.instance_name) : null,
    paymentName: deliveryData?.payment_name ? String(deliveryData.payment_name) : null,
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
    orderItemId: String(item.order_item_id || ""),
    code: String(item.code || ""),
    brandName: String(item.brand_name || ""),
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
export async function syncOrders(
  days = 3,
  dateFrom?: number,
  dateTo?: number,
  syncType: "manual" | "auto" = "manual"
): Promise<{ batchId: string; success: boolean; message: string }> {
  if (isSyncing) {
    return { batchId: "", success: false, message: "Sync already in progress" };
  }

  isSyncing = true;
  const batchId = nanoid();
  const db = await getDb();

  if (!db) {
    isSyncing = false;
    return { batchId, success: false, message: "Database not available" };
  }

  // Create sync log entry
  await db.insert(syncLogs).values({
    batchId,
    status: "running",
    syncType,
    ordersProcessed: 0,
    itemsProcessed: 0,
    newOrders: 0,
    modifiedOrders: 0,
    deletedOrders: 0,
  });

  try {
    let startDate: Date;
    let endDate: Date;

    if (dateFrom && dateTo) {
      // Custom range from explicit timestamps
      startDate = new Date(dateFrom * 1000);
      endDate = new Date(dateTo * 1000);
    } else {
      // Last N days
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - (days - 1));
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const rangeLabel = `${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)}`;
    console.log(`[Sync] Starting sync: ${rangeLabel}`);

    // Fetch from Vortex API day-by-day with pauses
    const fetchedOrders = await fetchOrdersByDateRange(startDate, endDate, (day, count) => {
      console.log(`[Sync] ${day}: ${count >= 0 ? count + " orders" : "FAILED"}`);
    });

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
      const rgEntries = await fetchRgByDateRange(startDate, endDate);
      console.log(`[Sync] Got ${rgEntries.length} RG entries, matching to order items...`);

      // Build a lookup: art_id+code+brand -> RG entry
      for (const rg of rgEntries) {
        const rgItems = (rg.items || []) as Array<Record<string, unknown>>;
        const supplierName = [rg.sup_name || ""].join("").trim();
        const rgId = String(rg.id || "");
        const rgTimestamp = rg.timestamp ? Number(rg.timestamp) : null;
        const rgCurrency = String(rg.currency || "uah");

        for (const rgItem of rgItems) {
          const artId = String(rgItem.art_id || "");
          const code = String(rgItem.code || "");
          const brand = String(rgItem.brand || "");
          const supplierTotal = rgItem.price ? String(rgItem.price) : null;

          if (!artId && !code) continue;

          // Find matching order_items by code + brand
          const matchConditions = [];
          if (code) matchConditions.push(eq(orderItems.code, code));
          if (brand) matchConditions.push(eq(orderItems.brandName, brand));

          if (matchConditions.length === 0) continue;

          const matchingItems = await db
            .select({ id: orderItems.id, supplierName: orderItems.supplierName })
            .from(orderItems)
            .where(and(...matchConditions))
            .limit(10);

          for (const mi of matchingItems) {
            // Only update if not already enriched
            if (!mi.supplierName) {
              await db
                .update(orderItems)
                .set({
                  supplierName,
                  supplierTotal,
                  supplierCurrency: rgCurrency,
                  rgId,
                  rgTimestamp,
                })
                .where(eq(orderItems.id, mi.id));
              rgEnriched++;
            }
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

    isSyncing = false;
    return { batchId, success: true, message: msg };
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

    isSyncing = false;
    return { batchId, success: false, message: errMsg };
  }
}

// Scheduled sync - runs daily at 00:00 Kyiv time (UTC+3)
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Returns milliseconds until next 00:00 Kyiv time (UTC+3).
 */
function msUntilMidnightKyiv(): number {
  const now = new Date();
  // Kyiv is UTC+3
  const kyivOffset = 3 * 60 * 60 * 1000;
  const kyivNow = new Date(now.getTime() + kyivOffset);
  const nextMidnight = new Date(kyivNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  return nextMidnight.getTime() - kyivNow.getTime();
}

export function startScheduledSync() {
  if (syncTimeout) return;

  const scheduleNext = () => {
    const delay = msUntilMidnightKyiv();
    const nextRun = new Date(Date.now() + delay);
    console.log(`[Sync] Next auto-sync scheduled at ${nextRun.toISOString()} (Kyiv 00:00)`);
    syncTimeout = setTimeout(async () => {
      syncTimeout = null;
      console.log("[Sync] Auto daily sync triggered (00:00 Kyiv)");
      try {
        await syncOrders(7, undefined, undefined, "auto"); // sync last 7 days
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
  const delay = msUntilMidnightKyiv();
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
