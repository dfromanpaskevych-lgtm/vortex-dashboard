/**
 * Enrich order_items with RG (supplier) data from get_rg_list.
 * Fetches all March 2026 RG entries and matches them to order items.
 */

import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, sql } from "drizzle-orm";
import { mysqlTable, int, varchar, text, decimal, bigint, json, timestamp } from "drizzle-orm/mysql-core";
import crypto from "crypto";
import http from "http";

const API_KEY = "1bTaa9TePTzS85Nl0zL9ATcYyktNf7ta";
const API_URL = "http://tz4.topaz.crm-vortex.com/front_api";
const db = drizzle(process.env.DATABASE_URL);

// Inline orderItems schema
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

async function main() {
  console.log("=== RG Supplier Data Enrichment for March 2026 ===\n");

  const marchStart = Math.floor(new Date("2026-03-01T00:00:00").getTime() / 1000);
  const marchEnd = Math.floor(new Date("2026-03-31T23:59:59").getTime() / 1000);

  let rgTotal = 0;
  let rgEnriched = 0;
  const allRg = [];

  // Fetch RG data day by day
  console.log("Fetching RG data day by day...");
  for (let day = 1; day <= 31; day++) {
    const dateStr = `2026-03-${String(day).padStart(2, "0")}`;
    const dayStart = Math.floor(new Date(`${dateStr}T00:00:00`).getTime() / 1000);
    const dayEnd = Math.floor(new Date(`${dateStr}T23:59:59`).getTime() / 1000);

    try {
      let page = 0;
      let hasMore = true;
      let dayCount = 0;

      while (hasMore) {
        const result = await apiWithRetry("get_rg_list", {
          page, page_size: 50, with_items: true,
          start_timestamp: dayStart, end_timestamp: dayEnd,
        });

        const items = result?.items || [];
        allRg.push(...items);
        dayCount += items.length;

        hasMore = !!result?.next_page_exists;
        page++;
        if (hasMore) await sleep(3000);
      }

      if (dayCount > 0) {
        console.log(`  ${dateStr}: ${dayCount} RG entries`);
      }
    } catch (err) {
      console.error(`  ${dateStr}: FAILED - ${err.message}`);
    }

    if (day < 31) await sleep(3000);
  }

  rgTotal = allRg.length;
  console.log(`\nTotal RG entries fetched: ${rgTotal}`);

  if (rgTotal === 0) {
    console.log("No RG data found. Exiting.");
    process.exit(0);
  }

  // Match RG items to order items using Drizzle
  console.log("\nMatching RG items to order items...");
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
            .set({ supplierName, supplierTotal, supplierCurrency: rgCurrency, rgId, rgTimestamp })
            .where(eq(orderItems.id, mi.id));
          rgEnriched++;
        }
      }
    }
  }

  // Final stats
  const supplierStats = await db
    .select({ c: sql`COUNT(*)` })
    .from(orderItems)
    .where(sql`${orderItems.supplierName} IS NOT NULL`);

  console.log(`\n=== RG Enrichment Complete ===`);
  console.log(`RG entries processed: ${rgTotal}`);
  console.log(`Items enriched: ${rgEnriched}`);
  console.log(`Total items with supplier: ${supplierStats[0].c}`);
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
