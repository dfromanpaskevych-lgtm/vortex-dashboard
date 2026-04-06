import { eq, and, or, like, desc, asc, sql, between, gte, lte, inArray, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, orders, orderItems, changeLogs, syncLogs } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user: database not available"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ ORDER QUERIES ============

interface OrderFilters {
  search?: string;
  manager?: string;
  status?: string;
  brand?: string;
  client?: string;
  dateFrom?: number;
  dateTo?: number;
  sortField?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function getOrdersList(filters: OrderFilters) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };

  const conditions: Array<ReturnType<typeof eq>> = [];

  if (filters.manager) {
    conditions.push(like(orders.managerName, `%${filters.manager}%`));
  }
  if (filters.client) {
    conditions.push(like(orders.clientName, `%${filters.client}%`));
  }
  if (filters.dateFrom) {
    conditions.push(gte(orders.createdTs, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(orders.createdTs, filters.dateTo));
  }

  // Build where clause
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build combined where for items join — excludes ВЛАСНА ЛОГІСТИКА from orders tab
  const buildFullWhere = () => {
    const logisticsExclude = sql`${orderItems.code} != 'ВЛАСНА ЛОГІСТИКА'`;
    if (filters.status || filters.brand || filters.search) {
      return and(
        whereClause,
        logisticsExclude,
        filters.status ? eq(orderItems.status, filters.status) : undefined,
        filters.brand ? like(orderItems.brandName, `%${filters.brand}%`) : undefined,
        filters.search
          ? or(
              like(orders.vortexOrderId, `%${filters.search}%`),
              like(orders.clientName, `%${filters.search}%`),
              like(orders.managerName, `%${filters.search}%`),
              like(orderItems.code, `%${filters.search}%`),
              like(orderItems.description, `%${filters.search}%`),
              like(orderItems.brandName, `%${filters.search}%`),
              like(orders.trackNumber, `%${filters.search}%`),
              like(orders.customerPhone, `%${filters.search}%`)
            )
          : undefined
      );
    }
    return and(whereClause, logisticsExclude);
  };

  // Get total count
  const [countResult] = await db
    .select({ total: sql<number>`count(DISTINCT ${orders.id})` })
    .from(orders)
    .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
    .where(buildFullWhere());

  const total = Number(countResult?.total || 0);

  // Determine sort
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const offset = (page - 1) * pageSize;

  let orderBy: ReturnType<typeof desc> = desc(orders.createdTs);
  if (filters.sortField) {
    const dir = filters.sortDir === "asc" ? asc : desc;
    const fieldMap: Record<string, any> = {
      num: orders.vortexOrderId,
      manager: orders.managerName,
      client: orders.clientName,
      created: orders.createdTs,
      sumUah: orders.sumUah,
      brand: orderItems.brandName,
      article: orderItems.code,
      status: orderItems.status,
      quantity: orderItems.qty,
      inputPrice: orderItems.basePrice,
      salePrice: orderItems.price,
    };
    if (fieldMap[filters.sortField]) {
      orderBy = dir(fieldMap[filters.sortField]);
    }
  }

  // Get order IDs with pagination using GROUP BY instead of DISTINCT
  const orderIdsQuery = await db
    .select({ id: orders.id, sortKey: sql`MAX(${orders.createdTs})`.as('sort_key') })
    .from(orders)
    .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
    .where(buildFullWhere())
    .groupBy(orders.id)
    .orderBy(desc(sql`sort_key`))
    .limit(pageSize)
    .offset(offset);

  if (orderIdsQuery.length === 0) return { rows: [], total };

  const ids = orderIdsQuery.map((r) => r.id);

  // Get full data with items
  const rows = await db
    .select({
      orderId: orders.id,
      vortexOrderId: orders.vortexOrderId,
      clientName: orders.clientName,
      managerName: orders.managerName,
      currency: orders.currency,
      sumUah: orders.sumUah,
      deliveryName: orders.deliveryName,
      customerPhone: orders.customerPhone,
      trackNumber: orders.trackNumber,
      createdTs: orders.createdTs,
      itemId: orderItems.id,
      code: orderItems.code,
      brandName: orderItems.brandName,
      description: orderItems.description,
      status: orderItems.status,
      whName: orderItems.whName,
      qty: orderItems.qty,
      basePrice: orderItems.basePrice,
      basePriceCurrency: orderItems.basePriceCurrency,
      price: orderItems.price,
      retailPrice: orderItems.retailPrice,
      itemCurrency: orderItems.currency,
      deliveryTime: orderItems.deliveryTime,
      realDeliveryTime: orderItems.realDeliveryTime,
      supplierName: orderItems.supplierName,
      supplierTotal: orderItems.supplierTotal,
      supplierCurrency: orderItems.supplierCurrency,
      rgId: orderItems.rgId,
      rgTimestamp: orderItems.rgTimestamp,
      fixedRate: orderItems.fixedRate,
      fixedRateDate: orderItems.fixedRateDate,
      balanceCurrencyTotal: orders.balanceCurrencyTotal,
      balanceCurrency: orders.balanceCurrency,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
    .where(and(
      inArray(orders.id, ids),
      sql`(${orderItems.code} IS NULL OR ${orderItems.code} != 'ВЛАСНА ЛОГІСТИКА')`
    ))
    .orderBy(orderBy);

  return { rows, total };
}

// ============ DASHBOARD METRICS ============

export async function getDashboardMetrics() {
  const db = await getDb();
  if (!db) return null;

  // Exclude ВЛАСНА ЛОГІСТИКА items from dashboard stats
  const noLogistics = sql`${orderItems.code} != 'ВЛАСНА ЛОГІСТИКА'`;

  // Total orders and sums
  const [totals] = await db.select({
    totalOrders: sql<number>`count(*)`,
    totalSumUah: sql<number>`COALESCE(SUM(${orders.sumUah}), 0)`,
    totalSumUsd: sql<number>`COALESCE(SUM(${orders.sumUsd}), 0)`,
    totalSumEur: sql<number>`COALESCE(SUM(${orders.sumEur}), 0)`,
  }).from(orders);

  // Total items (excluding logistics)
  const [itemTotals] = await db.select({
    totalItems: sql<number>`count(*)`,
    totalQty: sql<number>`COALESCE(SUM(${orderItems.qty}), 0)`,
  }).from(orderItems).where(noLogistics);

  // By manager
  const byManager = await db.select({
    manager: orders.managerName,
    orderCount: sql<number>`count(*)`,
    sumUah: sql<number>`COALESCE(SUM(${orders.sumUah}), 0)`,
  }).from(orders)
    .groupBy(orders.managerName)
    .orderBy(desc(sql`count(*)`))
    .limit(15);

  // By status (excluding logistics)
  const byStatus = await db.select({
    status: orderItems.status,
    count: sql<number>`count(*)`,
  }).from(orderItems)
    .where(noLogistics)
    .groupBy(orderItems.status)
    .orderBy(desc(sql`count(*)`));

  // By day (last 14 days)
  const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 86400;
  const byDay = await db.select({
    day: sql<string>`DATE(FROM_UNIXTIME(${orders.createdTs}))`.as('day_val'),
    orderCount: sql<number>`count(*)`,
    sumUah: sql<number>`COALESCE(SUM(${orders.sumUah}), 0)`,
  }).from(orders)
    .where(gte(orders.createdTs, fourteenDaysAgo))
    .groupBy(sql`day_val`)
    .orderBy(asc(sql`day_val`));

  // By brand (top 10, excluding logistics)
  const byBrand = await db.select({
    brand: orderItems.brandName,
    count: sql<number>`count(*)`,
  }).from(orderItems)
    .where(noLogistics)
    .groupBy(orderItems.brandName)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return {
    totals: { ...totals, ...itemTotals },
    byManager,
    byStatus,
    byDay,
    byBrand,
  };
}

// ============ LOGISTICS QUERIES ============

export async function getLogisticsList(filters: OrderFilters) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };

  const conditions: Array<ReturnType<typeof eq>> = [];

  if (filters.manager) {
    conditions.push(like(orders.managerName, `%${filters.manager}%`));
  }
  if (filters.client) {
    conditions.push(like(orders.clientName, `%${filters.client}%`));
  }
  if (filters.dateFrom) {
    conditions.push(gte(orders.createdTs, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(orders.createdTs, filters.dateTo));
  }

  // Only ВЛАСНА ЛОГІСТИКА items
  const logisticsFilter = sql`${orderItems.code} = 'ВЛАСНА ЛОГІСТИКА'`;

  const buildFullWhere = () => {
    const base = conditions.length > 0 ? and(...conditions) : undefined;
    if (filters.search) {
      return and(
        base,
        logisticsFilter,
        or(
          like(orders.vortexOrderId, `%${filters.search}%`),
          like(orders.clientName, `%${filters.search}%`),
          like(orders.managerName, `%${filters.search}%`),
          like(orderItems.description, `%${filters.search}%`),
          like(orders.trackNumber, `%${filters.search}%`)
        )
      );
    }
    return and(base, logisticsFilter);
  };

  // Get total count
  const [countResult] = await db
    .select({ total: sql<number>`count(*)` })
    .from(orders)
    .innerJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
    .where(buildFullWhere());

  const total = Number(countResult?.total || 0);

  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select({
      orderId: orders.id,
      vortexOrderId: orders.vortexOrderId,
      clientName: orders.clientName,
      managerName: orders.managerName,
      currency: orders.currency,
      sumUah: orders.sumUah,
      deliveryName: orders.deliveryName,
      customerPhone: orders.customerPhone,
      trackNumber: orders.trackNumber,
      createdTs: orders.createdTs,
      itemId: orderItems.id,
      code: orderItems.code,
      brandName: orderItems.brandName,
      description: orderItems.description,
      status: orderItems.status,
      whName: orderItems.whName,
      qty: orderItems.qty,
      basePrice: orderItems.basePrice,
      basePriceCurrency: orderItems.basePriceCurrency,
      price: orderItems.price,
      retailPrice: orderItems.retailPrice,
      itemCurrency: orderItems.currency,
      deliveryTime: orderItems.deliveryTime,
      realDeliveryTime: orderItems.realDeliveryTime,
      supplierName: orderItems.supplierName,
      supplierTotal: orderItems.supplierTotal,
      supplierCurrency: orderItems.supplierCurrency,
      rgId: orderItems.rgId,
      rgTimestamp: orderItems.rgTimestamp,
      fixedRate: orderItems.fixedRate,
      fixedRateDate: orderItems.fixedRateDate,
      balanceCurrencyTotal: orders.balanceCurrencyTotal,
      balanceCurrency: orders.balanceCurrency,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
    .where(buildFullWhere())
    .orderBy(desc(orders.createdTs))
    .limit(pageSize)
    .offset(offset);

  return { rows, total };
}

// ============ CHANGE TRACKING ============

export async function getChangeLogs(page = 1, pageSize = 50, changeType?: string) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };

  const conditions: Array<ReturnType<typeof eq>> = [];
  if (changeType && changeType !== "all") {
    conditions.push(eq(changeLogs.changeType, changeType as "new" | "modified" | "deleted"));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ total: sql<number>`count(*)` })
    .from(changeLogs)
    .where(whereClause);

  const rows = await db
    .select({
      id: changeLogs.id,
      vortexOrderId: changeLogs.vortexOrderId,
      changeType: changeLogs.changeType,
      fieldName: changeLogs.fieldName,
      oldValue: changeLogs.oldValue,
      newValue: changeLogs.newValue,
      syncBatchId: changeLogs.syncBatchId,
      createdAt: changeLogs.createdAt,
    })
    .from(changeLogs)
    .where(whereClause)
    .orderBy(desc(changeLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total: Number(countResult?.total || 0) };
}

// ============ FILTER OPTIONS ============

export async function getFilterOptions() {
  const db = await getDb();
  if (!db) return { managers: [], statuses: [], brands: [], clients: [] };

  const managers = await db
    .selectDistinct({ name: orders.managerName })
    .from(orders)
    .where(sql`${orders.managerName} IS NOT NULL AND ${orders.managerName} != ''`)
    .orderBy(orders.managerName);

  const statuses = await db
    .selectDistinct({ name: orderItems.status })
    .from(orderItems)
    .where(sql`${orderItems.status} IS NOT NULL AND ${orderItems.status} != ''`)
    .orderBy(orderItems.status);

  const brands = await db
    .selectDistinct({ name: orderItems.brandName })
    .from(orderItems)
    .where(sql`${orderItems.brandName} IS NOT NULL AND ${orderItems.brandName} != ''`)
    .orderBy(orderItems.brandName)
    .limit(100);

  const clients = await db
    .selectDistinct({ name: orders.clientName })
    .from(orders)
    .where(sql`${orders.clientName} IS NOT NULL AND ${orders.clientName} != ''`)
    .orderBy(orders.clientName)
    .limit(100);

  return {
    managers: managers.map((m) => m.name).filter(Boolean) as string[],
    statuses: statuses.map((s) => s.name).filter(Boolean) as string[],
    brands: brands.map((b) => b.name).filter(Boolean) as string[],
    clients: clients.map((c) => c.name).filter(Boolean) as string[],
  };
}

// ============ SYNC LOGS ============

export async function getSyncLogsList(limit = 20) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(syncLogs)
    .orderBy(desc(syncLogs.startedAt))
    .limit(limit);
}
