import { eq, and, sql, desc } from "drizzle-orm";
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

export async function syncOrders(days = 7): Promise<{ batchId: string; success: boolean; message: string }> {
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
    startDate.setDate(startDate.getDate() - days);

    console.log(`[Sync] Starting sync for ${days} days (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})`);

    const fetchedOrders = await fetchOrdersByDateRange(startDate, endDate, (day, count) => {
      console.log(`[Sync] ${day}: ${count >= 0 ? count + " orders" : "FAILED"}`);
    });

    let newCount = 0;
    let modifiedCount = 0;
    let totalItems = 0;

    for (const rawOrder of fetchedOrders) {
      const vortexOrderId = String(rawOrder.order_id || rawOrder.id || "");
      if (!vortexOrderId) continue;

      // Check if order exists
      const [existing] = await db
        .select()
        .from(orders)
        .where(eq(orders.vortexOrderId, vortexOrderId))
        .limit(1);

      const sumData = rawOrder.sum as Record<string, unknown> | undefined;
      const deliveryData = rawOrder.delivery_data as Record<string, unknown> | undefined;

      const orderData = {
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

      if (!existing) {
        // New order
        const [insertResult] = await db.insert(orders).values(orderData);
        const orderId = insertResult.insertId;

        await db.insert(changeLogs).values({
          vortexOrderId,
          changeType: "new",
          fieldName: "order",
          oldValue: null,
          newValue: JSON.stringify({ clientName: orderData.clientName, sumUah: orderData.sumUah }),
          syncBatchId: batchId,
        });

        // Insert items
        const items = (rawOrder.items || []) as Array<Record<string, unknown>>;
        for (const item of items) {
          await db.insert(orderItems).values({
            orderId: Number(orderId),
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
          });
          totalItems++;
        }

        newCount++;
      } else {
        // Check for changes
        const changes: Array<{ field: string; oldVal: string; newVal: string }> = [];
        const fieldsToCheck: Array<[string, keyof typeof orderData]> = [
          ["clientName", "clientName"],
          ["managerName", "managerName"],
          ["sumUah", "sumUah"],
          ["customerPhone", "customerPhone"],
          ["trackNumber", "trackNumber"],
          ["deliveryName", "deliveryName"],
        ];

        for (const [fieldLabel, fieldKey] of fieldsToCheck) {
          const oldVal = String(existing[fieldKey] ?? "");
          const newVal = String(orderData[fieldKey] ?? "");
          if (oldVal !== newVal) {
            changes.push({ field: fieldLabel, oldVal, newVal });
          }
        }

        // Check items count
        const existingItems = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.vortexOrderId, vortexOrderId));
        const newItems = (rawOrder.items || []) as Array<Record<string, unknown>>;

        if (existingItems.length !== newItems.length) {
          changes.push({
            field: "items_count",
            oldVal: String(existingItems.length),
            newVal: String(newItems.length),
          });
        }

        // Check item statuses
        for (const newItem of newItems) {
          const existingItem = existingItems.find(
            (ei) => ei.orderItemId === String(newItem.order_item_id || "")
          );
          if (existingItem && existingItem.status !== String(newItem.status || "")) {
            changes.push({
              field: `item_status_${newItem.code}`,
              oldVal: existingItem.status || "",
              newVal: String(newItem.status || ""),
            });
          }
        }

        if (changes.length > 0) {
          // Update order
          await db
            .update(orders)
            .set({ ...orderData, updatedAt: new Date() })
            .where(eq(orders.vortexOrderId, vortexOrderId));

          // Log changes
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

          // Update items - delete old and insert new
          await db.delete(orderItems).where(eq(orderItems.vortexOrderId, vortexOrderId));
          for (const item of newItems) {
            await db.insert(orderItems).values({
              orderId: existing.id,
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
            });
            totalItems++;
          }

          modifiedCount++;
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

    console.log(`[Sync] Completed: ${fetchedOrders.length} orders, ${newCount} new, ${modifiedCount} modified`);
    isSyncing = false;
    return { batchId, success: true, message: `Synced ${fetchedOrders.length} orders` };
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

/**
 * Seed database from the provided JSON file
 */
export async function seedFromJson(ordersData: Array<Record<string, unknown>>): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const batchId = `seed-${nanoid()}`;
  let count = 0;

  for (const rawOrder of ordersData) {
    const vortexOrderId = String(rawOrder.order_id || rawOrder.id || "");
    if (!vortexOrderId) continue;

    // Check if already exists
    const [existing] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.vortexOrderId, vortexOrderId))
      .limit(1);

    if (existing) continue;

    const sumData = rawOrder.sum as Record<string, unknown> | undefined;
    const deliveryData = rawOrder.delivery_data as Record<string, unknown> | undefined;

    const [insertResult] = await db.insert(orders).values({
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
    });

    const orderId = Number(insertResult.insertId);
    const items = (rawOrder.items || []) as Array<Record<string, unknown>>;

    for (const item of items) {
      await db.insert(orderItems).values({
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
      });
    }

    count++;
  }

  return count;
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
