import crypto from "crypto";
import http from "http";

const API_KEY = "1bTaa9TePTzS85Nl0zL9ATcYyktNf7ta";
const API_URL = "http://tz4.topaz.crm-vortex.com/front_api";

function rawPost(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname, port: parsed.port || 80,
      path: parsed.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: timeoutMs, agent: false,
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function hashRequest(requestData, apiKey) {
  const data = requestData.data;
  const sortedKeys = Object.keys(data).sort();
  const joinedData = sortedKeys.map((key) => {
    const value = data[key];
    let strValue;
    if (typeof value === "boolean") strValue = value ? "1" : "";
    else if (Array.isArray(value) || (typeof value === "object" && value !== null)) strValue = JSON.stringify(value);
    else strValue = String(value ?? "");
    return `${key}=${strValue}`;
  });
  const str = String(requestData.rand) + "+" + String(requestData.time) + "+" + apiKey + "+" +
    String(requestData.method) + "+" + JSON.stringify(requestData.cookies) + "+data:" + joinedData.join("&");
  return crypto.createHash("sha1").update(str, "utf-8").digest("hex");
}

async function makeRequest(method, methodData) {
  const currentTime = Math.floor(Date.now() / 1000);
  const randVal = Math.floor(Math.random() * 90000) + 10000;
  const requestData = { module: "Vortex", method, rand: randVal, time: currentTime, call_type: "crm", data: methodData, cookies: [] };
  requestData.hash = hashRequest(requestData, API_KEY);
  requestData.remote_address = "127.0.0.1";
  requestData.user_agent = "Mozilla/5.0";
  const body = JSON.stringify(requestData);
  const responseText = await rawPost(API_URL, body, 60000);
  return JSON.parse(responseText);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Fetch March 4 — has known dual orders (Діма: 86371 Адмінка + some EUR order)
  const dayStart = Math.floor(new Date("2026-03-04T00:00:00").getTime() / 1000);
  const dayEnd = Math.floor(new Date("2026-03-04T23:59:59").getTime() / 1000);
  
  console.log("=== Fetching March 4 ===");
  const result = await makeRequest("get_orders", { start_timestamp: dayStart, end_timestamp: dayEnd });
  const ordersMap = result.orders || {};
  const allOrders = Object.entries(ordersMap);
  
  // Group orders by client_id to find dual orders
  const byClient = {};
  for (const [id, o] of allOrders) {
    const cid = o.client_id;
    if (!byClient[cid]) byClient[cid] = [];
    byClient[cid].push({ id, ...o });
  }
  
  // Find clients with multiple orders (dual pattern)
  console.log("\n=== Clients with multiple orders on March 4 ===");
  for (const [cid, clientOrders] of Object.entries(byClient)) {
    if (clientOrders.length > 1) {
      console.log(`\nClient ID ${cid} (${clientOrders[0].client_name}) — ${clientOrders.length} orders:`);
      for (const o of clientOrders) {
        const isAdmin = String(o.manager_name || "").includes("Адмінка");
        console.log(`  Order ${o.id}: currency=${o.currency}, manager="${o.manager_name}", created=${o.created} ${isAdmin ? "⚠️ ADMIN" : "✅"}`);
        // Show items
        const items = o.items || [];
        for (const item of items) {
          console.log(`    Item: code="${item.code}", desc="${item.description}", status=${item.status}, price=${item.price} ${item.currency}`);
        }
      }
    }
  }
  
  // Also check March 6 for Вадим Шмагленко (О. Кісільчук vs В. Шмагленко)
  console.log("\n\n=== Fetching March 6 ===");
  await sleep(3000);
  const day6Start = Math.floor(new Date("2026-03-06T00:00:00").getTime() / 1000);
  const day6End = Math.floor(new Date("2026-03-06T23:59:59").getTime() / 1000);
  const result6 = await makeRequest("get_orders", { start_timestamp: day6Start, end_timestamp: day6End });
  const ordersMap6 = result6.orders || {};
  
  // Find Шмагленко
  console.log("\n=== Шмагленко orders on March 6 ===");
  for (const [id, o] of Object.entries(ordersMap6)) {
    if (String(o.client_name || "").toLowerCase().includes("шмагленко")) {
      console.log(`\nOrder ${id}: currency=${o.currency}, manager="${o.manager_name}", client="${o.client_name}", created=${o.created}`);
      const items = o.items || [];
      for (const item of items) {
        console.log(`  Item: code="${item.code}", desc="${item.description}", status=${item.status}, price=${item.price} ${item.currency}`);
      }
      // Print ALL fields of the order (not items)
      console.log("  --- All order fields ---");
      for (const [k, v] of Object.entries(o)) {
        if (k === "items" || k === "delivery_data" || k === "sum") continue;
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
    }
  }
  
  // Check March 9 for Кучеренко (dual: 86034 EUR Мосійчук + 86803 UAH Романюк)
  console.log("\n\n=== Fetching March 9 ===");
  await sleep(3000);
  const day9Start = Math.floor(new Date("2026-03-09T00:00:00").getTime() / 1000);
  const day9End = Math.floor(new Date("2026-03-09T23:59:59").getTime() / 1000);
  const result9 = await makeRequest("get_orders", { start_timestamp: day9Start, end_timestamp: day9End });
  const ordersMap9 = result9.orders || {};
  
  // Group by client_id for March 9
  const byClient9 = {};
  for (const [id, o] of Object.entries(ordersMap9)) {
    const cid = o.client_id;
    if (!byClient9[cid]) byClient9[cid] = [];
    byClient9[cid].push({ id, ...o });
  }
  
  console.log("\n=== Dual orders on March 9 (clients with >1 order) ===");
  for (const [cid, clientOrders] of Object.entries(byClient9)) {
    if (clientOrders.length > 1) {
      const hasAdmin = clientOrders.some(o => String(o.manager_name || "").includes("Адмінка") || String(o.manager_name || "").includes("Київ Адмін"));
      if (hasAdmin) {
        console.log(`\nClient ID ${cid} (${clientOrders[0].client_name}) — ${clientOrders.length} orders:`);
        for (const o of clientOrders) {
          const isAdmin = String(o.manager_name || "").includes("Адмінка") || String(o.manager_name || "").includes("Київ Адмін");
          console.log(`  Order ${o.id}: currency=${o.currency}, manager="${o.manager_name}", created=${o.created} ${isAdmin ? "⚠️ ADMIN" : "✅"}`);
          const items = o.items || [];
          for (const item of items) {
            console.log(`    Item: code="${item.code}", price=${item.price} ${item.currency}, status=${item.status}`);
          }
        }
      }
    }
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
