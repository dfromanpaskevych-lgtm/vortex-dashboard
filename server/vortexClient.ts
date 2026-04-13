import crypto from "crypto";
import http from "http";

const API_KEY = "1bTaa9TePTzS85Nl0zL9ATcYyktNf7ta";
const API_URL = "http://tz4.topaz.crm-vortex.com/front_api";

/**
 * Low-level HTTP POST using Node's built-in http module.
 * Each request creates a fresh connection (no keep-alive pooling)
 * to avoid stale/broken connections with the slow Vortex API.
 *
 * Accepts an optional AbortSignal — when aborted, the request is immediately
 * destroyed so the caller's Promise.race timeout actually kills the connection.
 */
function rawPost(url: string, body: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // If already aborted before we even start, reject immediately
    if (signal?.aborted) {
      reject(new Error("AbortError: request aborted before start"));
      return;
    }

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

    // Wire AbortSignal: when aborted, destroy the socket immediately
    if (signal) {
      const onAbort = () => {
        req.destroy(new Error("AbortError: chunk timeout — request killed"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Clean up listener when request finishes normally
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("AbortError: sleep aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("AbortError: sleep aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Make a single API request to Vortex.
 * Uses raw HTTP (no axios) with fresh connections.
 * Timeout: 30s (Vortex API is fast when healthy).
 * Accepts optional AbortSignal to kill the request immediately on abort.
 */
async function makeApiRequest(
  method: string,
  methodData: Record<string, unknown>,
  timeout = 30000,
  signal?: AbortSignal
): Promise<unknown> {
  if (signal?.aborted) throw new Error("AbortError: chunk timeout");

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
  const responseText = await rawPost(API_URL, body, timeout, signal);

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid JSON response: ${responseText.slice(0, 200)}`);
  }
}

/**
 * Make API request with retry strategy.
 * - Up to 5 attempts
 * - Short pauses between retries: 1s, 2s, 4s, 8s
 * - 30s timeout per request (60s for get_order_by_id)
 * - Accepts optional AbortSignal — aborted immediately on chunk timeout
 */
async function makeApiRequestWithRetry(
  method: string,
  methodData: Record<string, unknown>,
  maxRetries = 5,
  timeout = 30000,
  signal?: AbortSignal
): Promise<unknown> {
  const retryDelays = [1000, 2000, 4000, 8000, 15000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check abort before each attempt
    if (signal?.aborted) throw new Error("AbortError: chunk timeout");

    try {
      console.log(`[VortexAPI] ${method} attempt ${attempt + 1}/${maxRetries}...`);
      const result = await makeApiRequest(method, methodData, timeout, signal);
      return result;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // If aborted — propagate immediately, don't retry
      if (errMsg.includes("AbortError")) throw error;

      console.warn(`[VortexAPI] ${method} attempt ${attempt + 1}/${maxRetries} FAILED: ${errMsg}`);

      if (attempt < maxRetries - 1) {
        const waitTime = retryDelays[attempt] || 15000;
        console.log(`[VortexAPI] Waiting ${waitTime / 1000}s before retry...`);
        await sleep(waitTime, signal);
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
  endTimestamp: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const result = await makeApiRequestWithRetry("get_orders", {
    start_timestamp: startTimestamp,
    end_timestamp: endTimestamp,
  }, 5, 30000, signal);
  return result as Record<string, unknown>;
}

/**
 * Get a single order by ID.
 */
export async function getOrderById(orderId: string): Promise<Record<string, unknown>> {
  const result = await makeApiRequestWithRetry("get_order_by_id", { or_id: Number(orderId) }, 5, 30000);
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
 * Accepts optional AbortSignal for hard timeout.
 */
export async function fetchOrdersForDay(
  date: Date,
  signal?: AbortSignal
): Promise<Array<Record<string, unknown>>> {
  if (signal?.aborted) throw new Error("AbortError: chunk timeout");

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const startTs = Math.floor(dayStart.getTime() / 1000);
  const endTs = Math.floor(dayEnd.getTime() / 1000);

  const dayStr = date.toISOString().slice(0, 10);
  console.log(`[VortexAPI] Fetching orders for ${dayStr} (ts: ${startTs}-${endTs})`);

  const result = await getOrders(startTs, endTs, signal);
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
 * page_size=1000 to minimize number of requests.
 * Accepts optional AbortSignal for hard timeout.
 */
export async function getRgList(
  startTimestamp: number,
  endTimestamp: number,
  page = 0,
  pageSize = 1000,
  signal?: AbortSignal
): Promise<Array<Record<string, unknown>>> {
  if (signal?.aborted) throw new Error("AbortError: chunk timeout");

  const result = await makeApiRequestWithRetry("get_rg_list", {
    page,
    page_size: pageSize,
    with_items: true,
    start_timestamp: startTimestamp,
    end_timestamp: endTimestamp,
  }, 5, 30000, signal) as Record<string, unknown>;

  const items = result.items as Array<Record<string, unknown>> | undefined;
  if (!items || !Array.isArray(items)) {
    console.log(`[VortexAPI] get_rg_list: no items in response`);
    return [];
  }

  console.log(`[VortexAPI] get_rg_list: received ${items.length} RG entries (page ${page})`);

  // If next_page_exists, fetch more (no pause — fast API)
  const allItems = [...items];
  if (result.next_page_exists) {
    console.log(`[VortexAPI] get_rg_list: fetching next page...`);
    const nextItems = await getRgList(startTimestamp, endTimestamp, page + 1, pageSize, signal);
    allItems.push(...nextItems);
  }

  return allItems;
}

/**
 * Fetch all RG entries for a date range, one day at a time.
 * Accepts optional AbortSignal for hard timeout.
 */
export async function fetchRgByDateRange(
  startDate: Date,
  endDate: Date,
  signal?: AbortSignal
): Promise<Array<Record<string, unknown>>> {
  const allRg: Array<Record<string, unknown>> = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const endDay = new Date(endDate);
  endDay.setHours(23, 59, 59, 999);

  while (current <= endDay) {
    // Check abort at the start of each day
    if (signal?.aborted) throw new Error("AbortError: chunk timeout");

    const dayStart = new Date(current);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(current);
    dayEnd.setHours(23, 59, 59, 999);

    const startTs = Math.floor(dayStart.getTime() / 1000);
    const endTs = Math.floor(dayEnd.getTime() / 1000);
    const dayStr = current.toISOString().slice(0, 10);

    try {
      const rgEntries = await getRgList(startTs, endTs, 0, 1000, signal);
      allRg.push(...rgEntries);
      console.log(`[VortexAPI] RG for ${dayStr}: ${rgEntries.length} entries`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Propagate abort immediately
      if (errMsg.includes("AbortError")) throw error;
      console.error(`[VortexAPI] RG FAILED for ${dayStr}: ${errMsg}`);
    }

    current.setDate(current.getDate() + 1);
  }

  console.log(`[VortexAPI] Total RG entries: ${allRg.length}`);
  return allRg;
}

/**
 * Fetch orders for a date range, one day at a time.
 * No artificial pauses between days — requests are sequential but immediate.
 * Accepts optional AbortSignal for hard timeout.
 */
export async function fetchOrdersByDateRange(
  startDate: Date,
  endDate: Date,
  onProgress?: (day: string, count: number) => void,
  signal?: AbortSignal
): Promise<Array<Record<string, unknown>>> {
  const allOrders: Array<Record<string, unknown>> = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const endDay = new Date(endDate);
  endDay.setHours(23, 59, 59, 999);

  let dayIndex = 0;

  while (current <= endDay) {
    // Check abort at the start of each day
    if (signal?.aborted) throw new Error("AbortError: chunk timeout");

    const dayStr = current.toISOString().slice(0, 10);

    try {
      const dayOrders = await fetchOrdersForDay(new Date(current), signal);
      allOrders.push(...dayOrders);
      onProgress?.(dayStr, dayOrders.length);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Propagate abort immediately — don't swallow it
      if (errMsg.includes("AbortError")) throw error;
      console.error(`[VortexAPI] FAILED to fetch ${dayStr}: ${errMsg}`);
      onProgress?.(dayStr, -1);
    }

    // Move to next day
    current.setDate(current.getDate() + 1);
    dayIndex++;
  }

  console.log(`[VortexAPI] Total: ${allOrders.length} valid orders from ${dayIndex} days`);
  return allOrders;
}
