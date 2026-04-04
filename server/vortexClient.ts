import crypto from "crypto";
import axios from "axios";

const API_KEY = "1bTaa9TePTzS85Nl0zL9ATcYyktNf7ta";
const API_URL = "http://tz4.topaz.crm-vortex.com/front_api";

function phpValueToString(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "";
  if (Array.isArray(value) || (typeof value === "object" && value !== null))
    return JSON.stringify(value);
  return String(value ?? "");
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

  const response = await axios.post(API_URL, requestData, {
    timeout,
    headers: { "Content-Type": "application/json" },
  });

  return response.data;
}

async function makeApiRequestWithRetry(
  method: string,
  methodData: Record<string, unknown>,
  maxRetries = 5,
  timeout = 120000
): Promise<unknown> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await makeApiRequest(method, methodData, timeout);
      return result;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[VortexAPI] ${method} attempt ${attempt + 1}/${maxRetries} failed: ${errMsg}`);
      if (attempt < maxRetries - 1) {
        const waitTime = (1 + attempt * 1.5) * 1000;
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }
  }
  throw new Error(`[VortexAPI] ${method} failed after ${maxRetries} attempts`);
}

export async function getOrders(
  startTimestamp: number,
  endTimestamp: number,
  clientId?: string
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {
    start_timestamp: startTimestamp,
    end_timestamp: endTimestamp,
  };
  if (clientId) data.client_id = clientId;
  const result = await makeApiRequestWithRetry("get_orders", data);
  return result as Record<string, unknown>;
}

export async function getOrderById(orderId: string): Promise<Record<string, unknown>> {
  const result = await makeApiRequestWithRetry("get_order_by_id", { order_id: orderId });
  return result as Record<string, unknown>;
}

export async function getRgList(
  page = 0,
  pageSize = 50,
  withItems = true,
  startTimestamp?: number,
  endTimestamp?: number
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {
    page,
    page_size: pageSize,
    with_items: withItems,
  };
  if (startTimestamp !== undefined) data.start_timestamp = startTimestamp;
  if (endTimestamp !== undefined) data.end_timestamp = endTimestamp;
  const result = await makeApiRequestWithRetry("get_rg_list", data);
  return result as Record<string, unknown>;
}

/**
 * Fetch orders day-by-day for a date range.
 * This avoids timeouts by making smaller requests.
 */
export async function fetchOrdersByDateRange(
  startDate: Date,
  endDate: Date,
  onProgress?: (day: string, count: number) => void
): Promise<Array<Record<string, unknown>>> {
  const allOrders: Array<Record<string, unknown>> = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const dayStart = Math.floor(current.getTime() / 1000);
    const dayEnd = dayStart + 86399; // end of day

    const dayStr = current.toISOString().slice(0, 10);

    try {
      const result = await getOrders(dayStart, dayEnd);
      const ordersMap = (result as Record<string, unknown>).orders as Record<string, unknown> | undefined;

      if (ordersMap && typeof ordersMap === "object") {
        const entries = Object.entries(ordersMap);
        for (const [orderId, orderData] of entries) {
          const order = orderData as Record<string, unknown>;
          order.order_id = orderId;
          allOrders.push(order);
        }
        onProgress?.(dayStr, entries.length);
      } else {
        onProgress?.(dayStr, 0);
      }
    } catch (error) {
      console.error(`[VortexAPI] Failed to fetch orders for ${dayStr}:`, error);
      onProgress?.(dayStr, -1);
    }

    // Pause between requests to avoid overloading the API
    await new Promise((r) => setTimeout(r, 2000));
    current.setDate(current.getDate() + 1);
  }

  return allOrders;
}
