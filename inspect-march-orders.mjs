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

// Target orders from bug report:
// 56962 - 06.03 - client: Вадим Шмагленко - correct manager: В. Шмагленко - bug: О. Кісільчук
// 56727 - 04.03 - client: Діма - correct manager: Лясковець Вітьки - bug: Л. Київ Адмінка
// 57235 - 18.03 - client: Лисенко Павло - correct manager: Занюк Вітькі - bug: Ж. Романюк(Адмінка)
// 57030 - 09.03 - client: Кучеренко Дмитро - correct manager: Мосійчук Набережна - bug: Ж. Романюк(Адмінка)

const targetDays = [
  { date: "2026-03-04", targetIds: ["56727"], targetClients: ["Діма"] },
  { date: "2026-03-06", targetIds: ["56962"], targetClients: ["Вадим", "Шмагленко"] },
  { date: "2026-03-09", targetIds: ["57030"], targetClients: ["Кучеренко"] },
  { date: "2026-03-18", targetIds: ["57235"], targetClients: ["Лисенко"] },
];

async function main() {
  for (const { date, targetIds, targetClients } of targetDays) {
    const dayStart = Math.floor(new Date(`${date}T00:00:00`).getTime() / 1000);
    const dayEnd = Math.floor(new Date(`${date}T23:59:59`).getTime() / 1000);
    
    console.log(`\n=== Fetching ${date} ===`);
    const result = await makeRequest("get_orders", { start_timestamp: dayStart, end_timestamp: dayEnd });
    const ordersMap = result.orders || {};
    const orderIds = Object.keys(ordersMap);
    console.log(`Got ${orderIds.length} orders`);
    
    // Check if target IDs exist
    for (const tid of targetIds) {
      if (ordersMap[tid]) {
        const o = ordersMap[tid];
        console.log(`✓ Found order ${tid}: manager="${o.manager_name}", client="${o.client_name}"`);
        // Print all string fields
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === "string" && v.length > 0 && v.length < 300) {
            console.log(`  ${k}: "${v}"`);
          }
        }
      } else {
        console.log(`✗ Order ${tid} NOT in get_orders response`);
      }
    }
    
    // Search by client name
    for (const clientSearch of targetClients) {
      const matches = Object.entries(ordersMap).filter(([, o]) => 
        String(o.client_name || "").toLowerCase().includes(clientSearch.toLowerCase())
      );
      for (const [id, o] of matches) {
        console.log(`Found by client "${clientSearch}": order ${id}, manager="${o.manager_name}", client="${o.client_name}"`);
        // Print all fields
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === "string" && v.length > 0 && v.length < 300) {
            console.log(`  ${k}: "${v}"`);
          }
        }
      }
    }
    
    // Also show all "Адмінка" orders for this day
    const adminOrders = Object.entries(ordersMap).filter(([, o]) => 
      String(o.manager_name || "").includes("Адмінка") || String(o.manager_name || "").includes("Романюк") ||
      String(o.manager_name || "").includes("Київ Адмін")
    );
    if (adminOrders.length > 0) {
      console.log(`\nAdmin orders on ${date}:`);
      for (const [id, o] of adminOrders) {
        console.log(`  Order ${id}: manager="${o.manager_name}", client="${o.client_name}"`);
      }
    }
    
    await sleep(3000);
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
