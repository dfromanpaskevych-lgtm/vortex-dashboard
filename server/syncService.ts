import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import { orders, orderItems, orderSnapshots, changeLogs, syncLogs } from "../drizzle/schema";
import { fetchOrdersByDateRange } from "./vortexClient";
import { nanoid } from "nanoid";

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
 * Main sync function.
 * Fetches orders from Vortex API for the last N days (default 3).
 * Compares with existing data and logs all changes.
 */
export async function syncOrders(days = 3): Promise<{ batchId: string; success: boolean; message: string }> {
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
    ordersProcessed: 0,
    itemsProcessed: 0,
    newOrders: 0,
    modifiedOrders: 0,
    deletedOrders: 0,
  });

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1)); // e.g., 3 days = today, yesterday, day before

    console.log(`[Sync] Starting sync for ${days} days (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})`);

    // Fetch from Vortex API
    const fetchedOrders = await fetchOrdersByDateRange(startDate, endDate, (day, count) => {
      console.log(`[Sync] ${day}: ${count >= 0 ? count + " orders" : "FAILED"}`);
    });

    console.log(`[Sync] Fetched ${fetchedOrders.length} total valid orders from API`);

    let newCount = 0;
    let modifiedCount = 0;
    let totalItems = 0;

    // Process each fetched order
    for (const rawOrder of fetchedOrders) {
      const vortexOrderId = String(rawOrder.order_id || rawOrder.id || "");
      if (!vortexOrderId) continue;

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

        // Insert items
        for (const item of rawItems) {
          await db.insert(orderItems).values(mapItemToDb(item, orderId, vortexOrderId));
          totalItems++;
        }

        newCount++;
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

          // Replace items
          await db.delete(orderItems).where(eq(orderItems.vortexOrderId, vortexOrderId));
          for (const item of rawItems) {
            await db.insert(orderItems).values(mapItemToDb(item, existing.id, vortexOrderId));
            totalItems++;
          }

          modifiedCount++;
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

    const msg = `Synced ${fetchedOrders.length} orders (${newCount} new, ${modifiedCount} modified)`;
    console.log(`[Sync] Completed: ${msg}`);
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

// Scheduled sync - runs every 30 minutes
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduledSync() {
  if (syncInterval) return;

  console.log("[Sync] Starting scheduled sync (every 30 minutes)");
  syncInterval = setInterval(async () => {
    console.log("[Sync] Scheduled sync triggered");
    try {
      await syncOrders(3); // sync last 3 days
    } catch (error) {
      console.error("[Sync] Scheduled sync error:", error);
    }
  }, 30 * 60 * 1000); // 30 minutes
}

export function stopScheduledSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[Sync] Scheduled sync stopped");
  }
}
