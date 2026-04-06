import crypto from "crypto";
import http from "http";

const API_KEY = "1bTaa9TePTzS85Nl0zL9ATcYyktNf7ta";
const API_URL = "http://tz4.topaz.crm-vortex.com/front_api";

function rawPost(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: timeoutMs,
      agent: false,
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
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
    else if (Array.isArray(value) || (typeof value === "object" && value !== null))
      strValue = JSON.stringify(value);
    else strValue = String(value ?? "");
    return `${key}=${strValue}`;
  });
  const cookiesJson = JSON.stringify(requestData.cookies);
  const str = String(requestData.rand) + "+" + String(requestData.time) + "+" + apiKey + "+" +
    String(requestData.method) + "+" + cookiesJson + "+data:" + joinedData.join("&");
  return crypto.createHash("sha1").update(str, "utf-8").digest("hex");
}

async function makeRequest(method, methodData) {
  const currentTime = Math.floor(Date.now() / 1000);
  const randVal = Math.floor(Math.random() * 90000) + 10000;
  const requestData = {
    module: "Vortex",
    method,
    rand: randVal,
    time: currentTime,
    call_type: "crm",
    data: methodData,
    cookies: [],
  };
  requestData.hash = hashRequest(requestData, API_KEY);
  requestData.remote_address = "127.0.0.1";
  requestData.user_agent = "Mozilla/5.0 (Vortex Dashboard)";
  const body = JSON.stringify(requestData);
  const responseText = await rawPost(API_URL, body, 60000);
  return JSON.parse(responseText);
}

// Inspect order 56962 - should have manager В. Шмагленко but Manus shows О. Кісільчук
async function main() {
  console.log("=== Fetching order 56962 via get_order_by_id ===");
  const result = await makeRequest("get_order_by_id", { or_id: 56962 });
  
  // Print all top-level keys
  console.log("\nTop-level keys:", Object.keys(result).join(", "));
  
  // Find all fields that might contain manager info
  function findManagerFields(obj, path = "") {
    if (!obj || typeof obj !== "object") return;
    for (const [key, val] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (typeof val === "string" && val.length > 0 && val.length < 200) {
        // Print any field that looks like it could be a manager name
        if (key.toLowerCase().includes("manager") || key.toLowerCase().includes("user") || 
            key.toLowerCase().includes("admin") || key.toLowerCase().includes("responsible") ||
            key.toLowerCase().includes("created") || key.toLowerCase().includes("modified") ||
            key.toLowerCase().includes("editor") || key.toLowerCase().includes("operator") ||
            (typeof val === "string" && (val.includes("Шмагленко") || val.includes("Кісільчук") || 
             val.includes("Романюк") || val.includes("Лясковець") || val.includes("Занюк")))) {
          console.log(`  ${fullPath}: "${val}"`);
        }
      } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        findManagerFields(val, fullPath);
      }
    }
  }
  
  findManagerFields(result);
  
  // Also print the full result for inspection (truncated)
  const resultStr = JSON.stringify(result, null, 2);
  console.log("\n=== FULL JSON (first 5000 chars) ===");
  console.log(resultStr.slice(0, 5000));
  
  // Now also fetch via get_orders for the same day (06.03.2026) and find order 56962
  console.log("\n\n=== Fetching 06.03.2026 via get_orders to compare manager field ===");
  const dayStart = Math.floor(new Date("2026-03-06T00:00:00").getTime() / 1000);
  const dayEnd = Math.floor(new Date("2026-03-06T23:59:59").getTime() / 1000);
  const ordersResult = await makeRequest("get_orders", { start_timestamp: dayStart, end_timestamp: dayEnd });
  
  const ordersMap = ordersResult.orders || {};
  const order56962 = ordersMap["56962"];
  if (order56962) {
    console.log("\nOrder 56962 from get_orders - manager-related fields:");
    findManagerFields(order56962, "order56962");
    console.log("\nFull order 56962 from get_orders:");
    console.log(JSON.stringify(order56962, null, 2).slice(0, 3000));
  } else {
    console.log("Order 56962 NOT found in get_orders for 06.03.2026");
    console.log("Available order IDs:", Object.keys(ordersMap).slice(0, 10));
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
