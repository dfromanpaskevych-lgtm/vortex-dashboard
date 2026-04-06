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
    req.on("timeout", () => req.destroy(new Error(`Timeout`)));
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

async function main() {
  // Fetch 06.03.2026 orders
  const dayStart = Math.floor(new Date("2026-03-06T00:00:00").getTime() / 1000);
  const dayEnd = Math.floor(new Date("2026-03-06T23:59:59").getTime() / 1000);
  
  console.log("Fetching 06.03.2026 orders...");
  const result = await makeRequest("get_orders", { start_timestamp: dayStart, end_timestamp: dayEnd });
  
  const ordersMap = result.orders || {};
  const orderIds = Object.keys(ordersMap);
  console.log(`Got ${orderIds.length} orders. IDs: ${orderIds.slice(0,5).join(", ")}...`);
  
  // Print ALL keys from first order
  const firstOrder = ordersMap[orderIds[0]];
  console.log("\n=== ALL KEYS in first order ===");
  console.log(Object.keys(firstOrder).join(", "));
  
  // Print full first order
  console.log("\n=== FULL first order JSON ===");
  console.log(JSON.stringify(firstOrder, null, 2).slice(0, 4000));
  
  // Find orders with client "Вадим Шмагленко" or manager containing "Шмагленко" or "Кісільчук"
  console.log("\n=== Searching for Шмагленко/Кісільчук orders ===");
  for (const [id, order] of Object.entries(ordersMap)) {
    const o = order;
    const managerName = String(o.manager_name || "");
    const clientName = String(o.client_name || "");
    if (managerName.includes("Шмагленко") || managerName.includes("Кісільчук") || 
        clientName.includes("Шмагленко") || clientName.includes("Вадим")) {
      console.log(`\nOrder ${id}: manager="${managerName}", client="${clientName}"`);
      // Print all string fields
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && v.length > 0 && v.length < 300) {
          console.log(`  ${k}: "${v}"`);
        }
      }
    }
  }
  
  // Also look at items of first order to understand structure
  console.log("\n=== First order items (first item) ===");
  const items = firstOrder.items || [];
  if (items.length > 0) {
    console.log(JSON.stringify(items[0], null, 2));
  }
  
  // Check what "Л. Київ Адмінка" looks like in manager_name
  console.log("\n=== Orders with Адмінка in manager ===");
  let adminCount = 0;
  for (const [id, order] of Object.entries(ordersMap)) {
    const managerName = String(order.manager_name || "");
    if (managerName.includes("Адмінка") || managerName.includes("Романюк") || managerName.includes("Київ")) {
      console.log(`Order ${id}: manager="${managerName}", client="${order.client_name}"`);
      // Print all fields
      for (const [k, v] of Object.entries(order)) {
        if (typeof v === "string" && v.length > 0 && v.length < 300 && 
            (k.includes("manager") || k.includes("user") || k.includes("responsible") || k.includes("admin"))) {
          console.log(`  ${k}: "${v}"`);
        }
      }
      adminCount++;
      if (adminCount >= 3) break;
    }
  }
  
  // Print ALL keys from one order to see if there are hidden manager fields
  console.log("\n=== Checking for hidden manager fields in ALL orders (first 5) ===");
  for (const [id, order] of Object.entries(ordersMap).slice(0, 5)) {
    const allKeys = Object.keys(order);
    const managerKeys = allKeys.filter(k => 
      k.toLowerCase().includes("manager") || k.toLowerCase().includes("user") || 
      k.toLowerCase().includes("responsible") || k.toLowerCase().includes("operator") ||
      k.toLowerCase().includes("admin") || k.toLowerCase().includes("editor")
    );
    console.log(`Order ${id} - manager-related keys: ${managerKeys.join(", ") || "NONE"}`);
    for (const k of managerKeys) {
      console.log(`  ${k}: ${JSON.stringify(order[k])}`);
    }
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
