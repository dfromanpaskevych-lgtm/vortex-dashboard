/**
 * Load all March 2026 orders from Vortex API, day by day.
 * Uses Drizzle ORM query builder (same as syncService.ts) for DB operations.
 * 
 * Phase 1: Fetch orders from API (31 days)
 * Phase 2: Save to database using Drizzle
 * Phase 3: Enrich with balance data (get_order_by_id)
 * Phase 4: Enrich with RG/supplier data (get_rg_list)
 */

import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, sql } from "drizzle-orm";
import { mysqlTable, int, varchar, text, decimal, bigint, json, timestamp, mysqlEnum, boolean } from "drizzle-orm/mysql-core";
import crypto from "crypto";
import http from "http";

// Inline schema definitions (mirrors drizzle/schema.ts)
const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  vortexOrderId: varchar("vortexOrderId", { length: 32 }).notNull().unique(),
  clientId: varchar("clientId", { length: 32 }),
  clientName: text("clientName"),
  managerName: text("managerName"),
  currency: varchar("currency", { length: 10 }),
  clientNote: text("clientNote"),
  managerNote: text("managerNote"),
  sumUah: decimal("sumUah", { precision: 12, scale: 2 }),
  sumUsd: decimal("sumUsd", { precision: 12, scale: 2 }),
  sumEur: decimal("sumEur", { precision: 12, scale: 2 }),
  deliveryProvider: varchar("deliveryProvider", { length: 100 }),
  deliveryName: text("deliveryName"),
  customerPhone: varchar("customerPhone", { length: 30 }),
  trackNumber: varchar("trackNumber", { length: 64 }),
  cityName: varchar("cityName", { length: 100 }),
  instanceName: text("instanceName"),
  paymentName: varchar("paymentName", { length: 100 }),
  codAmount: decimal("codAmount", { precision: 12, scale: 2 }),
  codCurrency: varchar("codCurrency", { length: 10 }),
  balanceCurrencyTotal: decimal("balanceCurrencyTotal", { precision: 12, scale: 2 }),
  balanceCurrency: varchar("balanceCurrency", { length: 10 }),
  rawJson: json("rawJson"),
  createdTs: bigint("createdTs", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
});

const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  vortexOrderId: varchar("vortexOrderId", { length: 32 }).notNull(),
  orderItemId: varchar("orderItemId", { length: 32 }),
  code: varchar("code", { length: 100 }),
  brandName: varchar("brandName", { length: 100 }),
  description: text("description"),
  status: varchar("status", { length: 30 }),
  whName: text("whName"),
  whId: varchar("whId", { length: 20 }),
  qty: int("qty"),
  price: decimal("price", { precision: 12, scale: 2 }),
  basePrice: decimal("basePrice", { precision: 12, scale: 2 }),
  basePriceCurrency: varchar("basePriceCurrency", { length: 10 }),
  retailPrice: decimal("retailPrice", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  deliveryTime: bigint("deliveryTime", { mode: "number" }),
  realDeliveryTime: bigint("realDeliveryTime", { mode: "number" }),
  deliveryName: text("deliveryName"),
  clientNote: text("clientNote"),
  managerNote: text("managerNote"),
  returnPeriod: varchar("returnPeriod", { length: 10 }),
  supplierName: text("supplierName"),
  supplierTotal: decimal("supplierTotal", { precision: 12, scale: 2 }),
  supplierCurrency: varchar("supplierCurrency", { length: 10 }),
  rgId: varchar("rgId", { length: 32 }),
  rgTimestamp: bigint("rgTimestamp", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

const API_KEY = "1bTaa9TePTzS85Nl0zL9ATcYyktNf7ta";
const API_URL = "http://tz4.topaz.crm-vortex.com/front_api";
const db = drizzle(process.env.DATABASE_URL);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function rawPost(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: timeoutMs,
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout ${timeoutMs}ms`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function hashRequest(requestData, apiKey) {
  const data = requestData.data;
  const sortedKeys = Object.keys(data).sort();
  const joinedData = sortedKeys.map(key => {
    const value = data[key];
    let strValue;
    if (typeof value === "boolean") strValue = value ? "1" : "";
    else if (Array.isArray(value) || (typeof value === "object" && value !== null)) strValue = JSON.stringify(value);
    else strValue = String(value ?? "");
    return `${key}=${strValue}`;
  });
  const cookiesJson = JSON.stringify(requestData.cookies);
  const str = String(requestData.rand) + "+" + String(requestData.time) + "+" + apiKey + "+" +
    String(requestData.method) + "+" + cookiesJson + "+data:" + joinedData.join("&");
  return crypto.createHash("sha1").update(str, "utf-8").digest("hex");
}

async function apiRequest(method, methodData, timeout = 120000) {
  const currentTime = Math.floor(Date.now() / 1000);
  const randVal = Math.floor(Math.random() * 90000) + 10000;
  const requestData = {
    module: "Vortex", method, rand: randVal, time: currentTime,
    call_type: "crm", data: methodData, cookies: [],
  };
  requestData.hash = hashRequest(requestData, API_KEY);
  requestData.remote_address = "127.0.0.1";
  requestData.user_agent = "Mozilla/5.0 (Vortex Dashboard)";
  const body = JSON.stringify(requestData);
  const responseText = await rawPost(API_URL, body, timeout);
  try { return JSON.parse(responseText); }
  catch { throw new Error(`Invalid JSON: ${responseText.slice(0, 200)}`); }
}

async function apiWithRetry(method, data, maxRetries = 7) {
  const delays = [3000, 5000, 8000, 12000, 18000, 25000, 30000];
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiRequest(method, data);
    } catch (err) {
      console.log(`  [RETRY] ${method} attempt ${i+1}/${maxRetries} failed: ${err.message}`);
      if (i < maxRetries - 1) {
        const wait = delays[i] || 30000;
        console.log(`  [RETRY] Waiting ${wait/1000}s...`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`${method} failed after ${maxRetries} attempts`);
}

// Map raw order to DB fields (same as syncService.ts)
function mapOrderToDb(rawOrder) {
  const vortexOrderId = String(rawOrder.order_id || rawOrder.id || "");
  const sumData = rawOrder.sum || {};
  const deliveryData = rawOrder.delivery_data || {};

  return {
    vortexOrderId,
    clientId: String(rawOrder.client_id || ""),
    clientName: String(rawOrder.client_name || "").trim(),
    managerName: String(rawOrder.manager_name || "").trim(),
    currency: String(rawOrder.currency || "uah"),
    clientNote: String(rawOrder.client_note || ""),
    managerNote: String(rawOrder.manager_note || ""),
    sumUah: sumData.uah != null ? String(sumData.uah) : null,
    sumUsd: sumData.usd != null ? String(sumData.usd) : null,
    sumEur: sumData.eur != null ? String(sumData.eur) : null,
    deliveryProvider: deliveryData.delivery_name ? String(deliveryData.delivery_name) : null,
    deliveryName: deliveryData.delivery_name ? String(deliveryData.delivery_name) : null,
    customerPhone: deliveryData.customer_phone ? String(deliveryData.customer_phone) : null,
    trackNumber: deliveryData.track_number ? String(deliveryData.track_number) : null,
    cityName: deliveryData.city_name ? String(deliveryData.city_name) : null,
    instanceName: deliveryData.instance_name ? String(deliveryData.instance_name) : null,
    paymentName: deliveryData.payment_name ? String(deliveryData.payment_name) : null,
    codAmount: deliveryData.cod_amount != null ? String(deliveryData.cod_amount) : null,
    codCurrency: deliveryData.cod_currency ? String(deliveryData.cod_currency) : null,
    rawJson: rawOrder,
    createdTs: rawOrder.created ? Number(rawOrder.created) : null,
    syncedAt: new Date(),
  };
}

// Map raw item to DB fields (same as syncService.ts)
function mapItemToDb(item, orderId, vortexOrderId) {
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

// ===== MAIN =====
async function main() {
  console.log("=== Loading March 2026 orders ===");
  console.log("Period: 2026-03-01 to 2026-03-31");
  console.log("");

  // ===== PHASE 1: Clear existing data =====
  console.log("Phase 0: Clearing existing data...");
  await db.delete(orderItems);
  await db.delete(orders);
  console.log("  Database cleared.\n");

  // ===== PHASE 1: Fetch orders from API =====
  const allOrders = [];
  let totalItems = 0;

  for (let day = 1; day <= 31; day++) {
    const dateStr = `2026-03-${String(day).padStart(2, "0")}`;
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59`);
    const startTs = Math.floor(dayStart.getTime() / 1000);
    const endTs = Math.floor(dayEnd.getTime() / 1000);

    console.log(`[Day ${day}/31] ${dateStr} ...`);

    try {
      const result = await apiWithRetry("get_orders", {
        start_timestamp: startTs,
        end_timestamp: endTs,
      });

      const ordersMap = result?.orders;
      if (!ordersMap || typeof ordersMap !== "object") {
        console.log(`  → 0 orders`);
      } else {
        const entries = Object.entries(ordersMap);
        console.log(`  → ${entries.length} orders`);

        for (const [orderId, orderData] of entries) {
          orderData.order_id = orderId;
          allOrders.push(orderData);
          const items = orderData.items || [];
          totalItems += items.length;
        }
      }
    } catch (err) {
      console.error(`  → FAILED: ${err.message}`);
    }

    // Pause between days
    if (day < 31) {
      await sleep(5000);
    }
  }

  console.log(`\n=== Fetched ${allOrders.length} orders, ${totalItems} items ===`);

  // ===== PHASE 2: Save to DB using Drizzle ORM =====
  console.log("Phase 2: Saving to database using Drizzle ORM...\n");
  let savedOrders = 0;
  let savedItems = 0;

  for (const rawOrder of allOrders) {
    const vortexOrderId = String(rawOrder.order_id || rawOrder.id || "");
    if (!vortexOrderId) continue;

    const orderData = mapOrderToDb(rawOrder);

    // Check if already exists (dedup by vortexOrderId)
    const existing = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.vortexOrderId, vortexOrderId))
      .limit(1);

    let dbOrderId;
    if (existing.length > 0) {
      // Update existing
      await db
        .update(orders)
        .set({ ...orderData, updatedAt: new Date() })
        .where(eq(orders.vortexOrderId, vortexOrderId));
      dbOrderId = existing[0].id;
    } else {
      // Insert new
      const [insertResult] = await db.insert(orders).values(orderData);
      dbOrderId = Number(insertResult.insertId);
    }

    savedOrders++;

    // Save items - delete old first, then insert new
    await db.delete(orderItems).where(eq(orderItems.vortexOrderId, vortexOrderId));

    const items = rawOrder.items || [];
    for (const item of items) {
      await db.insert(orderItems).values(mapItemToDb(item, dbOrderId, vortexOrderId));
      savedItems++;
    }

    if (savedOrders % 100 === 0) {
      console.log(`  Saved ${savedOrders}/${allOrders.length} orders, ${savedItems} items...`);
    }
  }

  console.log(`\n=== Saved ${savedOrders} orders, ${savedItems} items to DB ===`);

  // ===== PHASE 3: ENRICH WITH BALANCE DATA =====
  console.log("\n=== Phase 3: Enriching with balance data (get_order_by_id) ===");
  console.log("This will take a while (~2s per order)...\n");

  const uniqueOrderIds = [...new Set(allOrders.map(o => String(o.order_id || o.id || "")))].filter(Boolean);
  let balanceCount = 0;
  let balanceFailed = 0;

  for (let i = 0; i < uniqueOrderIds.length; i++) {
    const oid = uniqueOrderIds[i];
    try {
      const detail = await apiWithRetry("get_order_by_id", { or_id: Number(oid) }, 5);
      if (detail && typeof detail === "object") {
        const bct = detail.balance_currency_total != null ? String(detail.balance_currency_total) : null;
        const bc = detail.balance_currency ? String(detail.balance_currency) : null;
        if (bct || bc) {
          await db
            .update(orders)
            .set({ balanceCurrencyTotal: bct, balanceCurrency: bc })
            .where(eq(orders.vortexOrderId, oid));
          balanceCount++;
        }
      }
    } catch (err) {
      balanceFailed++;
      if (balanceFailed <= 5) {
        console.log(`  Balance FAILED for ${oid}: ${err.message}`);
      }
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  Balance: ${i + 1}/${uniqueOrderIds.length} (${balanceCount} enriched, ${balanceFailed} failed)`);
    }

    // Pause between requests
    if (i < uniqueOrderIds.length - 1) {
      await sleep(2000);
    }
  }

  console.log(`\n=== Balance enrichment: ${balanceCount}/${uniqueOrderIds.length} enriched, ${balanceFailed} failed ===`);

  // ===== PHASE 4: ENRICH WITH RG DATA =====
  console.log("\n=== Phase 4: Enriching with RG (supplier) data ===");

  const marchStart = Math.floor(new Date("2026-03-01T00:00:00").getTime() / 1000);
  const marchEnd = Math.floor(new Date("2026-03-31T23:59:59").getTime() / 1000);

  let rgTotal = 0;
  let rgEnriched = 0;

  try {
    // Fetch RG page by page
    let page = 0;
    let hasMore = true;
    const allRg = [];

    while (hasMore) {
      const result = await apiWithRetry("get_rg_list", {
        page, page_size: 50, with_items: true,
        start_timestamp: marchStart, end_timestamp: marchEnd,
      }, 5);

      const rgItems = result?.items || [];
      allRg.push(...rgItems);
      console.log(`  RG page ${page}: ${rgItems.length} entries`);

      hasMore = !!result?.next_page_exists;
      page++;
      if (hasMore) await sleep(3000);
    }

    rgTotal = allRg.length;
    console.log(`  Total RG entries: ${rgTotal}`);

    // Match RG items to order items using Drizzle
    for (const rg of allRg) {
      const rgItemsList = rg.items || [];
      const supplierName = String(rg.sup_name || "").trim();
      const rgId = String(rg.id || "");
      const rgTimestamp = rg.timestamp ? Number(rg.timestamp) : null;
      const rgCurrency = String(rg.currency || "uah");

      for (const rgItem of rgItemsList) {
        const code = String(rgItem.code || "");
        const brand = String(rgItem.brand || "");
        const supplierTotal = rgItem.price ? String(rgItem.price) : null;

        if (!code) continue;

        // Find matching order items using Drizzle
        const conditions = [eq(orderItems.code, code)];
        if (brand) conditions.push(eq(orderItems.brandName, brand));

        const matchingItems = await db
          .select({ id: orderItems.id, supplierName: orderItems.supplierName })
          .from(orderItems)
          .where(and(...conditions))
          .limit(10);

        for (const mi of matchingItems) {
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
  } catch (err) {
    console.error(`  RG enrichment error: ${err.message}`);
  }

  console.log(`\n=== RG enrichment: ${rgEnriched} items enriched from ${rgTotal} RG entries ===`);

  // ===== FINAL STATS =====
  const orderCount = await db.select({ c: sql`COUNT(*)` }).from(orders);
  const itemCount = await db.select({ c: sql`COUNT(*)` }).from(orderItems);
  const balanceStats = await db
    .select({ c: sql`COUNT(*)` })
    .from(orders)
    .where(sql`${orders.balanceCurrencyTotal} IS NOT NULL`);
  const supplierStats = await db
    .select({ c: sql`COUNT(*)` })
    .from(orderItems)
    .where(sql`${orderItems.supplierName} IS NOT NULL`);

  console.log("\n========================================");
  console.log("=== MARCH 2026 LOAD COMPLETE ===");
  console.log(`Orders: ${orderCount[0].c}`);
  console.log(`Items: ${itemCount[0].c}`);
  console.log(`With balance: ${balanceStats[0].c}`);
  console.log(`With supplier: ${supplierStats[0].c}`);
  console.log("========================================\n");

  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
