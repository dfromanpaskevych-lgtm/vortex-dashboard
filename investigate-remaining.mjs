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
  // Check March 26 for Є. Бардаш (invoice 57521, Устименко Кирило, article 13X502)
  console.log("=== March 26 — looking for Є. Бардаш / М. Мілінічук ===");
  const day26Start = Math.floor(new Date("2026-03-26T00:00:00").getTime() / 1000);
  const day26End = Math.floor(new Date("2026-03-26T23:59:59").getTime() / 1000);
  const result26 = await makeRequest("get_orders", { start_timestamp: day26Start, end_timestamp: day26End });
  const orders26 = result26.orders || {};
  
  for (const [id, o] of Object.entries(orders26)) {
    const name = String(o.client_name || "").toLowerCase();
    const mgr = String(o.manager_name || "");
    if (name.includes("устименко") || mgr.includes("Бардаш") || mgr.includes("Мілінічук")) {
      console.log(`Order ${id}: currency=${o.currency}, manager="${mgr}", client="${o.client_name}", created=${o.created}`);
      for (const item of (o.items || [])) {
        console.log(`  Item: code="${item.code}", price=${item.price} ${item.currency}, status=${item.status}`);
      }
    }
  }
  
  await sleep(3000);
  
  // Check March 20 for І. Гопанчук (invoice 56966, Іван Волод., article 1 987 301 015)
  console.log("\n=== March 20 — looking for І. Гопанчук / І. Платонов ===");
  const day20Start = Math.floor(new Date("2026-03-20T00:00:00").getTime() / 1000);
  const day20End = Math.floor(new Date("2026-03-20T23:59:59").getTime() / 1000);
  const result20 = await makeRequest("get_orders", { start_timestamp: day20Start, end_timestamp: day20End });
  const orders20 = result20.orders || {};
  
  for (const [id, o] of Object.entries(orders20)) {
    const name = String(o.client_name || "").toLowerCase();
    const mgr = String(o.manager_name || "");
    if (name.includes("іван") || name.includes("волод") || mgr.includes("Гопанчук") || mgr.includes("Платонов")) {
      console.log(`Order ${id}: currency=${o.currency}, manager="${mgr}", client="${o.client_name}", created=${o.created}`);
      for (const item of (o.items || [])) {
        console.log(`  Item: code="${item.code}", price=${item.price} ${item.currency}, status=${item.status}`);
      }
    }
  }
  
  await sleep(3000);
  
  // Now let's do a FULL scan of all March to find ALL admin orders and their pairs
  console.log("\n\n=== FULL MARCH SCAN: Finding all admin orders and their EUR pairs ===");
  
  const adminPatterns = ["Адмінка", "Київ Адмін"];
  const wrongManagerPatterns = ["О. Кісільчук", "Є. Бардаш", "І. Гопанчук"];
  
  let totalAdminOrders = 0;
  let adminWithPair = 0;
  let adminWithoutPair = 0;
  
  for (let day = 1; day <= 31; day++) {
    const dateStr = `2026-03-${String(day).padStart(2, "0")}`;
    const dayStart = Math.floor(new Date(`${dateStr}T00:00:00`).getTime() / 1000);
    const dayEnd = Math.floor(new Date(`${dateStr}T23:59:59`).getTime() / 1000);
    
    const result = await makeRequest("get_orders", { start_timestamp: dayStart, end_timestamp: dayEnd });
    const ordersMap = result.orders || {};
    const allOrders = Object.entries(ordersMap);
    
    // Group by client_id
    const byClient = {};
    for (const [id, o] of allOrders) {
      const cid = o.client_id;
      if (!byClient[cid]) byClient[cid] = [];
      byClient[cid].push({ id, ...o });
    }
    
    // Find admin orders
    for (const [cid, clientOrders] of Object.entries(byClient)) {
      for (const o of clientOrders) {
        const mgr = String(o.manager_name || "");
        const isAdmin = adminPatterns.some(p => mgr.includes(p));
        if (isAdmin) {
          totalAdminOrders++;
          // Find paired non-admin order with same created timestamp
          const pair = clientOrders.find(other => {
            const otherMgr = String(other.manager_name || "");
            return other.id !== o.id && 
                   other.created === o.created && 
                   !adminPatterns.some(p => otherMgr.includes(p));
          });
          if (pair) {
            adminWithPair++;
          } else {
            adminWithoutPair++;
            console.log(`  NO PAIR: ${dateStr} order ${o.id}, client="${o.client_name}", manager="${mgr}"`);
          }
        }
      }
    }
    
    if (day % 5 === 0) console.log(`  ... scanned ${day}/31 days`);
    await sleep(2000);
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total admin orders: ${totalAdminOrders}`);
  console.log(`Admin with EUR pair: ${adminWithPair}`);
  console.log(`Admin WITHOUT pair: ${adminWithoutPair}`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
