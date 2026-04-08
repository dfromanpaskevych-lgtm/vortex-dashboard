/**
 * Backfill balanceCurrencyBasePrice for all existing order_items.
 *
 * Strategy:
 *  1. UAH items → balanceCurrencyBasePrice = basePrice (already in UAH)
 *  2. EUR/USD items with fixedRate → balanceCurrencyBasePrice = basePrice × fixedRate
 *  3. EUR/USD items without fixedRate but with a currency_rates entry for the order date
 *     → balanceCurrencyBasePrice = basePrice × rate from currency_rates
 *  4. Remaining → leave NULL (will be filled on next sync)
 */
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const conn = await mysql.createConnection(DATABASE_URL);

// ---- Step 1: UAH items ----
console.log("Step 1: Setting balanceCurrencyBasePrice = basePrice for UAH items...");
const [uahResult] = await conn.execute(`
  UPDATE order_items
  SET balanceCurrencyBasePrice = basePrice
  WHERE (basePriceCurrency = 'uah' OR basePriceCurrency IS NULL)
    AND basePrice IS NOT NULL
    AND balanceCurrencyBasePrice IS NULL
`);
console.log(`  Updated ${uahResult.affectedRows} UAH items`);

// ---- Step 2: EUR/USD items WITH fixedRate ----
console.log("Step 2: Setting balanceCurrencyBasePrice = basePrice × fixedRate for items with fixedRate...");
const [rateResult] = await conn.execute(`
  UPDATE order_items
  SET balanceCurrencyBasePrice = ROUND(CAST(basePrice AS DECIMAL(12,4)) * CAST(fixedRate AS DECIMAL(10,4)), 2)
  WHERE basePriceCurrency IN ('eur', 'usd')
    AND basePrice IS NOT NULL
    AND fixedRate IS NOT NULL
    AND fixedRate > 0
    AND balanceCurrencyBasePrice IS NULL
`);
console.log(`  Updated ${rateResult.affectedRows} EUR/USD items with fixedRate`);

// ---- Step 3: EUR/USD items WITHOUT fixedRate — use currency_rates by order date ----
console.log("Step 3: Setting balanceCurrencyBasePrice using currency_rates for remaining EUR/USD items...");

// Get all remaining EUR/USD items without fixedRate
const [remainingItems] = await conn.execute(`
  SELECT oi.id, oi.basePrice, oi.basePriceCurrency, o.createdTs
  FROM order_items oi
  JOIN orders o ON o.vortexOrderId = oi.vortexOrderId
  WHERE oi.basePriceCurrency IN ('eur', 'usd')
    AND oi.basePrice IS NOT NULL
    AND (oi.fixedRate IS NULL OR oi.fixedRate = 0)
    AND oi.balanceCurrencyBasePrice IS NULL
    AND o.createdTs IS NOT NULL
`);

console.log(`  Found ${remainingItems.length} items to process with currency_rates lookup`);

// Load all currency rates into a map for fast lookup
const [allRates] = await conn.execute(`SELECT date, currency, rate FROM currency_rates`);
const ratesMap = new Map();
for (const r of allRates) {
  ratesMap.set(`${r.date}:${r.currency.toLowerCase()}`, Number(r.rate));
}

let step3Updated = 0;
let step3Skipped = 0;
const batchSize = 500;
const updates = [];

for (const item of remainingItems) {
  const orderDate = new Date(item.createdTs * 1000).toISOString().slice(0, 10); // YYYY-MM-DD
  const currency = item.basePriceCurrency.toLowerCase();
  const rate = ratesMap.get(`${orderDate}:${currency}`);

  if (rate && rate > 0) {
    const balancePrice = Math.round(Number(item.basePrice) * rate * 100) / 100;
    updates.push([balancePrice, item.id]);
    step3Updated++;
  } else {
    step3Skipped++;
  }
}

// Apply updates in batches
for (let i = 0; i < updates.length; i += batchSize) {
  const batch = updates.slice(i, i + batchSize);
  if (batch.length === 0) break;
  const placeholders = batch.map(() => "WHEN id = ? THEN ?").join(" ");
  const ids = batch.map(([, id]) => id);
  const values = batch.flatMap(([val, id]) => [id, val]);
  await conn.execute(
    `UPDATE order_items SET balanceCurrencyBasePrice = CASE ${placeholders} END WHERE id IN (${ids.map(() => "?").join(",")})`,
    [...values, ...ids]
  );
}

console.log(`  Updated ${step3Updated} items using currency_rates lookup`);
console.log(`  Skipped ${step3Skipped} items (no matching rate — will be NULL)`);

// ---- Summary ----
const [summary] = await conn.execute(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN balanceCurrencyBasePrice IS NOT NULL THEN 1 ELSE 0 END) as filled,
    SUM(CASE WHEN balanceCurrencyBasePrice IS NULL THEN 1 ELSE 0 END) as remaining_null
  FROM order_items
`);
console.log("\n=== BACKFILL SUMMARY ===");
console.log(`Total items: ${summary[0].total}`);
console.log(`Filled: ${summary[0].filled}`);
console.log(`Still NULL: ${summary[0].remaining_null}`);

await conn.end();
console.log("\n✅ Backfill complete!");
