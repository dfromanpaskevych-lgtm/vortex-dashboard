import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { currencyRates } from "../drizzle/schema";

const MONOBANK_URL = "https://api.monobank.ua/bank/currency";
const NBU_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";

// ISO 4217 codes
const CURRENCY_CODES: Record<string, number> = { USD: 840, EUR: 978, UAH: 980 };

// In-memory cache to avoid hammering APIs within same sync run
const memoryCache: Record<string, { rate: number; ts: number }> = {};
const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch current rates from Monobank (rateSell for USD and EUR → UAH).
 * Returns { USD: number, EUR: number } or null on failure.
 */
async function fetchMonobankRates(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(MONOBANK_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      currencyCodeA: number;
      currencyCodeB: number;
      rateSell?: number;
      rateBuy?: number;
      rateCross?: number;
    }>;

    const rates: Record<string, number> = {};
    for (const item of data) {
      if (item.currencyCodeB !== CURRENCY_CODES.UAH) continue;
      if (item.currencyCodeA === CURRENCY_CODES.USD && item.rateSell) {
        rates.USD = item.rateSell;
      }
      if (item.currencyCodeA === CURRENCY_CODES.EUR && item.rateSell) {
        rates.EUR = item.rateSell;
      }
    }
    return Object.keys(rates).length > 0 ? rates : null;
  } catch (err) {
    console.warn("[Currency] Monobank API failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Fetch rate from NBU for a specific date and currency.
 * NBU has historical rates for any date.
 * @param currency "USD" or "EUR"
 * @param dateStr "YYYY-MM-DD"
 */
async function fetchNbuRate(currency: string, dateStr: string): Promise<number | null> {
  try {
    // NBU expects date as YYYYMMDD
    const nbuDate = dateStr.replace(/-/g, "");
    const url = `${NBU_URL}?valcode=${currency}&date=${nbuDate}&json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ rate: number }>;
    return data?.[0]?.rate ?? null;
  } catch (err) {
    console.warn(`[Currency] NBU API failed for ${currency} on ${dateStr}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Get exchange rate for a currency on a specific date.
 * Priority: DB cache → memory cache → Monobank (for today) → NBU (for any date).
 * Caches result in DB for future lookups.
 * 
 * @param currency "usd", "eur", "USD", "EUR"
 * @param dateStr "YYYY-MM-DD"
 * @returns rate (how many UAH per 1 unit of foreign currency), or null if UAH or unavailable
 */
export async function getExchangeRate(currency: string, dateStr: string): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === "UAH" || cur === "ГРН") return 1;
  if (cur !== "USD" && cur !== "EUR") return null;

  const cacheKey = `${cur}_${dateStr}`;

  // 1. Check memory cache
  const memCached = memoryCache[cacheKey];
  if (memCached && Date.now() - memCached.ts < MEMORY_CACHE_TTL) {
    return memCached.rate;
  }

  // 2. Check DB cache
  const db = await getDb();
  if (db) {
    const [cached] = await db
      .select()
      .from(currencyRates)
      .where(and(eq(currencyRates.date, dateStr), eq(currencyRates.currency, cur)))
      .limit(1);

    if (cached) {
      const rate = Number(cached.rate);
      memoryCache[cacheKey] = { rate, ts: Date.now() };
      return rate;
    }
  }

  // 3. Try Monobank (best for today/recent dates)
  let rate: number | null = null;
  const today = new Date().toISOString().slice(0, 10);

  if (dateStr === today) {
    const monoRates = await fetchMonobankRates();
    if (monoRates && monoRates[cur]) {
      rate = monoRates[cur];
      // Cache both USD and EUR if we got them
      if (db) {
        for (const [c, r] of Object.entries(monoRates)) {
          const key = `${c}_${dateStr}`;
          memoryCache[key] = { rate: r, ts: Date.now() };
          try {
            await db.insert(currencyRates).values({
              date: dateStr,
              currency: c,
              rate: String(r),
              source: "monobank",
            });
          } catch {
            // Might already exist from concurrent insert
          }
        }
      }
      return rate;
    }
  }

  // 4. Fallback to NBU (works for any historical date)
  rate = await fetchNbuRate(cur, dateStr);
  if (rate !== null) {
    memoryCache[cacheKey] = { rate, ts: Date.now() };
    if (db) {
      try {
        await db.insert(currencyRates).values({
          date: dateStr,
          currency: cur,
          rate: String(rate),
          source: "nbu",
        });
      } catch {
        // Might already exist
      }
    }
    return rate;
  }

  console.warn(`[Currency] Could not get rate for ${cur} on ${dateStr}`);
  return null;
}

/**
 * Convert a unix timestamp (seconds) to YYYY-MM-DD string.
 */
export function timestampToDateStr(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}
