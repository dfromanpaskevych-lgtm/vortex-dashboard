import crypto from "crypto";
import http from "http";

const API_KEY = "1bTaa9TePTzS85Nl0zL9ATcYyktNf7ta";
const API_URL = "http://tz4.topaz.crm-vortex.com/front_api";

/**
 * Low-level HTTP POST using Node's built-in http module.
 * Each request creates a fresh connection (no keep-alive pooling)
 * to avoid stale/broken connections with the slow Vortex API.
 */
function rawPost(url: string, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: timeoutMs,
      // No keep-alive — fresh connection every time
      agent: false,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString("utf-8");
        resolve(data);
      });
      res.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function hashRequest(requestData: Record<string, unknown>, apiKey: string): string {
  const data = requestData.data as Record<string, unknown>;
  const sortedKeys = Object.keys(data).sort();

  const joinedData = sortedKeys.map((key) => {
    const value = data[key];
    let strValue: string;
    if (typeof value === "boolean") strValue = value ? "1" : "";
    else if (Array.isArray(value) || (typeof value === "object" && value !== null))
      strValue = JSON.stringify(value);
    else strValue = String(value ?? "");
    return `${key}=${strValue}`;
  });

  const cookiesJson = JSON.stringify(requestData.cookies);
  const joinedDataString =
    String(requestData.rand) + "+" +
    String(requestData.time) + "+" +
    apiKey + "+" +
    String(requestData.method) + "+" +
    cookiesJson +
    "+data:" + joinedData.join("&");

  return crypto.createHash("sha1").update(joinedDataString, "utf-8").digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Make a single API request to Vortex.
 * Uses raw HTTP (no axios) with fresh connections.
 */
async function makeApiRequest(
  method: string,
  methodData: Record<string, unknown>,
  timeout = 120000
): Promise<unknown> {
  const currentTime = Math.floor(Date.now() / 1000);
  const randVal = Math.floor(Math.random() * 90000) + 10000;

  const requestData: Record<string, unknown> = {
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
  const responseText = await rawPost(API_URL, body, timeout);

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid JSON response: ${responseText.slice(0, 200)}`);
  }
}

/**
 * Make API request with aggressive retry strategy.
 * - Up to 7 attempts
 * - Increasing pauses between retries (3s, 5s, 8s, 12s, 18s, 25s)
 * - 120s timeout per request
 */
async function makeApiRequestWithRetry(
  method: string,
  methodData: Record<string, unknown>,
  maxRetries = 7,
  timeout = 120000
): Promise<unknown> {
  const retryDelays = [3000, 5000, 8000, 12000, 18000, 25000, 30000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[VortexAPI] ${method} attempt ${attempt + 1}/${maxRetries}...`);
      const result = await makeApiRequest(method, methodData, timeout);
      return result;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[VortexAPI] ${method} attempt ${attempt + 1}/${maxRetries} FAILED: ${errMsg}`);

      if (attempt < maxRetries - 1) {
        const waitTime = retryDelays[attempt] || 30000;
        console.log(`[VortexAPI] Waiting ${waitTime / 1000}s before retry...`);
        await sleep(waitTime);
      }
    }
  }
  throw new Error(`[VortexAPI] ${method} failed after ${maxRetries} attempts`);
}

/**
 * Get orders for a specific timestamp range.
 */
export async function getOrders(
  startTimestamp: number,
  endTimestamp: number
): Promise<Record<string, unknown>> {
  const result = await makeApiRequestWithRetry("get_orders", {
    start_timestamp: startTimestamp,
    end_timestamp: endTimestamp,
  });
  return result as Record<string, unknown>;
}

/**
 * Get a single order by ID.
 */
export async function getOrderById(orderId: string): Promise<Record<string, unknown>> {
  const result = await makeApiRequestWithRetry("get_order_by_id", { or_id: Number(orderId) }, 5, 120000);
  return result as Record<string, unknown>;
}

/**
 * Validate that an order record has the minimum required fields.
 */
function validateOrder(order: Record<string, unknown>, orderId: string): boolean {
  // Must have an ID
  if (!orderId) {
    console.warn(`[Validate] Order skipped: no ID`);
    return false;
  }

  // Must have created timestamp
  const created = order.created;
  if (!created || Number(created) === 0) {
    console.warn(`[Validate] Order ${orderId} skipped: no created timestamp`);
    return false;
  }

  // Must have client_name or client_id
  if (!order.client_name && !order.client_id) {
    console.warn(`[Validate] Order ${orderId} skipped: no client info`);
    return false;
  }

  return true;
}

/**
 * Validate that an item record has the minimum required fields.
 */
function validateItem(item: Record<string, unknown>, orderId: string): boolean {
  if (!item.order_item_id && !item.code) {
    console.warn(`[Validate] Item in order ${orderId} skipped: no item_id or code`);
    return false;
  }
  return true;
}

/**
 * Fetch orders for exactly ONE day.
 * Returns validated, clean order records.
 */
export async function fetchOrdersForDay(
  date: Date
): Promise<Array<Record<string, unknown>>> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const startTs = Math.floor(dayStart.getTime() / 1000);
  const endTs = Math.floor(dayEnd.getTime() / 1000);

  const dayStr = date.toISOString().slice(0, 10);
  console.log(`[VortexAPI] Fetching orders for ${dayStr} (ts: ${startTs}-${endTs})`);

  const result = await getOrders(startTs, endTs);
  const ordersMap = result.orders as Record<string, unknown> | undefined;

  if (!ordersMap || typeof ordersMap !== "object") {
    console.log(`[VortexAPI] ${dayStr}: no orders in response`);
    return [];
  }

  const entries = Object.entries(ordersMap);
  console.log(`[VortexAPI] ${dayStr}: received ${entries.length} raw orders`);

  // Validate each order
  const validOrders: Array<Record<string, unknown>> = [];
  for (const [orderId, orderData] of entries) {
    const order = orderData as Record<string, unknown>;
    order.order_id = orderId;

    if (validateOrder(order, orderId)) {
      // Validate items
      const items = (order.items || []) as Array<Record<string, unknown>>;
      const validItems = items.filter((item) => validateItem(item, orderId));
      order.items = validItems;

      if (items.length !== validItems.length) {
        console.warn(`[Validate] Order ${orderId}: ${items.length - validItems.length} invalid items removed`);
      }

      validOrders.push(order);
    }
  }

  console.log(`[VortexAPI] ${dayStr}: ${validOrders.length} valid orders (${entries.length - validOrders.length} rejected)`);
  return validOrders;
}

/**
 * Get RG list (receipts/invoices from suppliers) for a timestamp range.
 * Returns array of RG entries with supplier info.
 */
export async function getRgList(
  startTimestamp: number,
  endTimestamp: number,
  page = 0,
  pageSize = 50
): Promise<Array<Record<string, unknown>>> {
  const result = await makeApiRequestWithRetry("get_rg_list", {
    page,
    page_size: pageSize,
    with_items: true,
    start_timestamp: startTimestamp,
    end_timestamp: endTimestamp,
  }) as Record<string, unknown>;

  const items = result.items as Array<Record<string, unknown>> | undefined;
  if (!items || !Array.isArray(items)) {
    console.log(`[VortexAPI] get_rg_list: no items in response`);
    return [];
  }

  console.log(`[VortexAPI] get_rg_list: received ${items.length} RG entries (page ${page})`);

  // If next_page_exists, fetch more
  const allItems = [...items];
  if (result.next_page_exists) {
    console.log(`[VortexAPI] get_rg_list: fetching next page...`);
    await sleep(3000);
    const nextItems = await getRgList(startTimestamp, endTimestamp, page + 1, pageSize);
    allItems.push(...nextItems);
  }

  return allItems;
}

/**
 * Fetch all RG entries for a date range, one day at a time.
 */
export async function fetchRgByDateRange(
  startDate: Date,
  endDate: Date
): Promise<Array<Record<string, unknown>>> {
  const allRg: Array<Record<string, unknown>> = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const endDay = new Date(endDate);
  endDay.setHours(23, 59, 59, 999);

  while (current <= endDay) {
    const dayStart = new Date(current);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(current);
    dayEnd.setHours(23, 59, 59, 999);

    const startTs = Math.floor(dayStart.getTime() / 1000);
    const endTs = Math.floor(dayEnd.getTime() / 1000);
    const dayStr = current.toISOString().slice(0, 10);

    try {
      const rgEntries = await getRgList(startTs, endTs);
      allRg.push(...rgEntries);
      console.log(`[VortexAPI] RG for ${dayStr}: ${rgEntries.length} entries`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VortexAPI] RG FAILED for ${dayStr}: ${errMsg}`);
    }

    current.setDate(current.getDate() + 1);
    if (current <= endDay) {
      await sleep(3000);
    }
  }

  console.log(`[VortexAPI] Total RG entries: ${allRg.length}`);
  return allRg;
}

/**
 * Fetch orders for the last N days, one day at a time.
 * Large pauses between days to avoid overloading the API.
 */
export async function fetchOrdersByDateRange(
  startDate: Date,
  endDate: Date,
  onProgress?: (day: string, count: number) => void
): Promise<Array<Record<string, unknown>>> {
  const allOrders: Array<Record<string, unknown>> = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const endDay = new Date(endDate);
  endDay.setHours(23, 59, 59, 999);

  let dayIndex = 0;

  while (current <= endDay) {
    const dayStr = current.toISOString().slice(0, 10);

    try {
      const dayOrders = await fetchOrdersForDay(new Date(current));
      allOrders.push(...dayOrders);
      onProgress?.(dayStr, dayOrders.length);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VortexAPI] FAILED to fetch ${dayStr}: ${errMsg}`);
      onProgress?.(dayStr, -1);
    }

    // Move to next day
    current.setDate(current.getDate() + 1);
    dayIndex++;

    // Large pause between days (5 seconds) to let the API breathe
    if (current <= endDay) {
      console.log(`[VortexAPI] Pausing 5s before next day...`);
      await sleep(5000);
    }
  }

  console.log(`[VortexAPI] Total: ${allOrders.length} valid orders from ${dayIndex} days`);
  return allOrders;
}
