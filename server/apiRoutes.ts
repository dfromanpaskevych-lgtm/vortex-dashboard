/**
 * REST API v1 routes for external application access.
 * All endpoints require API Key authentication via Bearer token.
 *
 * Endpoints:
 *   GET  /api/v1/orders          — List orders with filters, pagination
 *   GET  /api/v1/orders/:id      — Single order with all items
 *   GET  /api/v1/logistics       — Logistics entries
 *   GET  /api/v1/changes         — Change history
 *   GET  /api/v1/sync/status     — Current sync status
 */
import { Router, Request, Response } from "express";
import { requireApiKey } from "./apiAuth";
import { getDb } from "./db";
import { orders, orderItems, changeLogs, syncLogs } from "../drizzle/schema";
import { eq, desc, asc, and, like, or, gte, lte, sql, inArray } from "drizzle-orm";

const apiRouter = Router();

// All routes require API key
apiRouter.use(requireApiKey);

// ============ GET /api/v1/orders ============
apiRouter.get("/orders", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    // Parse query params
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize as string) || 100));
    const offset = (page - 1) * pageSize;
    const manager = req.query.manager as string | undefined;
    const status = req.query.status as string | undefined;
    const brand = req.query.brand as string | undefined;
    const client = req.query.client as string | undefined;
    const search = req.query.search as string | undefined;
    const dateFrom = req.query.dateFrom ? parseInt(req.query.dateFrom as string) : undefined;
    const dateTo = req.query.dateTo ? parseInt(req.query.dateTo as string) : undefined;
    const sortField = req.query.sortField as string | undefined;
    const sortDir = (req.query.sortDir as string) === "asc" ? "asc" : "desc";

    // Build conditions
    const conditions: Array<ReturnType<typeof eq>> = [];
    const logisticsExclude = sql`${orderItems.code} != 'ВЛАСНА ЛОГІСТИКА'`;

    if (manager) conditions.push(like(orders.managerName, `%${manager}%`));
    if (client) conditions.push(like(orders.clientName, `%${client}%`));
    if (dateFrom) conditions.push(gte(orders.createdTs, dateFrom));
    if (dateTo) conditions.push(lte(orders.createdTs, dateTo));
    if (status) conditions.push(eq(orderItems.status, status));
    if (brand) conditions.push(like(orderItems.brandName, `%${brand}%`));
    if (search) {
      conditions.push(
        or(
          like(orders.vortexOrderId, `%${search}%`),
          like(orders.clientName, `%${search}%`),
          like(orders.managerName, `%${search}%`),
          like(orderItems.code, `%${search}%`),
          like(orderItems.description, `%${search}%`),
          like(orderItems.brandName, `%${search}%`)
        ) as any
      );
    }

    const whereClause = conditions.length > 0
      ? and(...conditions, logisticsExclude)
      : logisticsExclude;

    // Count total
    const [countResult] = await db
      .select({ total: sql<number>`count(DISTINCT ${orders.id})` })
      .from(orders)
      .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
      .where(whereClause);

    const total = Number(countResult?.total || 0);

    // Get paginated order IDs
    const orderIdsQuery = await db
      .select({ id: orders.id })
      .from(orders)
      .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
      .where(whereClause)
      .groupBy(orders.id)
      .orderBy(desc(orders.createdTs))
      .limit(pageSize)
      .offset(offset);

    if (orderIdsQuery.length === 0) {
      res.json({ data: [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
      return;
    }

    const ids = orderIdsQuery.map((r) => r.id);

    // Get full data
    const rows = await db
      .select({
        orderId: orders.id,
        vortexOrderId: orders.vortexOrderId,
        clientId: orders.clientId,
        clientName: orders.clientName,
        managerName: orders.managerName,
        currency: orders.currency,
        clientNote: orders.clientNote,
        managerNote: orders.managerNote,
        sumUah: orders.sumUah,
        sumUsd: orders.sumUsd,
        sumEur: orders.sumEur,
        deliveryProvider: orders.deliveryProvider,
        deliveryName: orders.deliveryName,
        customerPhone: orders.customerPhone,
        trackNumber: orders.trackNumber,
        cityName: orders.cityName,
        instanceName: orders.instanceName,
        paymentName: orders.paymentName,
        codAmount: orders.codAmount,
        codCurrency: orders.codCurrency,
        balanceCurrencyTotal: orders.balanceCurrencyTotal,
        balanceCurrency: orders.balanceCurrency,
        createdTs: orders.createdTs,
        updatedAt: orders.updatedAt,
        syncedAt: orders.syncedAt,
        // Item fields
        itemId: orderItems.id,
        orderItemId: orderItems.orderItemId,
        code: orderItems.code,
        brandName: orderItems.brandName,
        description: orderItems.description,
        status: orderItems.status,
        whName: orderItems.whName,
        whId: orderItems.whId,
        qty: orderItems.qty,
        price: orderItems.price,
        basePrice: orderItems.basePrice,
        basePriceCurrency: orderItems.basePriceCurrency,
        retailPrice: orderItems.retailPrice,
        itemCurrency: orderItems.currency,
        deliveryTime: orderItems.deliveryTime,
        realDeliveryTime: orderItems.realDeliveryTime,
        itemDeliveryName: orderItems.deliveryName,
        itemClientNote: orderItems.clientNote,
        itemManagerNote: orderItems.managerNote,
        returnPeriod: orderItems.returnPeriod,
        supplierName: orderItems.supplierName,
        supplierTotal: orderItems.supplierTotal,
        supplierCurrency: orderItems.supplierCurrency,
        rgId: orderItems.rgId,
        rgTimestamp: orderItems.rgTimestamp,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
      .where(and(
        inArray(orders.id, ids),
        sql`(${orderItems.code} IS NULL OR ${orderItems.code} != 'ВЛАСНА ЛОГІСТИКА')`
      ))
      .orderBy(desc(orders.createdTs));

    // Group by order
    const ordersMap = new Map<string, { order: Record<string, unknown>; items: Array<Record<string, unknown>> }>();

    for (const row of rows) {
      const key = row.vortexOrderId;
      if (!ordersMap.has(key)) {
        ordersMap.set(key, {
          order: {
            vortexOrderId: row.vortexOrderId,
            clientId: row.clientId,
            clientName: row.clientName,
            managerName: row.managerName,
            currency: row.currency,
            clientNote: row.clientNote,
            managerNote: row.managerNote,
            sumUah: row.sumUah,
            sumUsd: row.sumUsd,
            sumEur: row.sumEur,
            deliveryProvider: row.deliveryProvider,
            deliveryName: row.deliveryName,
            customerPhone: row.customerPhone,
            trackNumber: row.trackNumber,
            cityName: row.cityName,
            instanceName: row.instanceName,
            paymentName: row.paymentName,
            codAmount: row.codAmount,
            codCurrency: row.codCurrency,
            balanceCurrencyTotal: row.balanceCurrencyTotal,
            balanceCurrency: row.balanceCurrency,
            createdTs: row.createdTs,
            createdDate: row.createdTs ? new Date(row.createdTs * 1000).toISOString() : null,
            updatedAt: row.updatedAt,
            syncedAt: row.syncedAt,
          },
          items: [],
        });
      }

      if (row.itemId) {
        const itemQty = Number(row.qty) || 1;
        const itemPrice = row.price ? Number(row.price) : null;
        const itemBase = row.basePrice ? Number(row.basePrice) : null;
        // Vortex delta = (price_per_unit - base_price_per_unit) × qty
        const itemDelta = itemPrice != null && itemBase != null ? ((itemPrice - itemBase) * itemQty).toFixed(2) : null;
        ordersMap.get(key)!.items.push({
          orderItemId: row.orderItemId,
          code: row.code,
          brandName: row.brandName,
          description: row.description,
          status: row.status,
          whName: row.whName,
          whId: row.whId,
          qty: row.qty,
          price: row.price,
          basePrice: row.basePrice,
          basePriceCurrency: row.basePriceCurrency,
          delta: itemDelta,
          retailPrice: row.retailPrice,
          currency: row.itemCurrency,
          deliveryTime: row.deliveryTime,
          realDeliveryTime: row.realDeliveryTime,
          deliveryName: row.itemDeliveryName,
          clientNote: row.itemClientNote,
          managerNote: row.itemManagerNote,
          returnPeriod: row.returnPeriod,
          supplierName: row.supplierName,
          supplierTotal: row.supplierTotal,
          supplierCurrency: row.supplierCurrency,
          rgId: row.rgId,
          rgTimestamp: row.rgTimestamp,
        });
      }
    }

    const data = Array.from(ordersMap.values()).map((entry) => ({
      ...entry.order,
      items: entry.items,
    }));

    res.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("[API] GET /orders error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ GET /api/v1/orders/:id ============
apiRouter.get("/orders/:id", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const vortexOrderId = req.params.id;

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.vortexOrderId, vortexOrderId))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Order not found", vortexOrderId });
      return;
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.vortexOrderId, vortexOrderId));

    // Get change history for this order
    const changes = await db
      .select()
      .from(changeLogs)
      .where(eq(changeLogs.vortexOrderId, vortexOrderId))
      .orderBy(desc(changeLogs.createdAt))
      .limit(100);

    // Add computed delta to each item
    const itemsWithDelta = items.map((item: any) => {
      const itemQty = Number(item.qty) || 1;
      const itemPrice = item.price ? Number(item.price) : null;
      const itemBase = item.basePrice ? Number(item.basePrice) : null;
      const delta = itemPrice != null && itemBase != null ? ((itemPrice - itemBase) * itemQty).toFixed(2) : null;
      return { ...item, delta };
    });

    res.json({
      order: {
        ...order,
        createdDate: order.createdTs ? new Date(order.createdTs * 1000).toISOString() : null,
      },
      items: itemsWithDelta,
      changes,
    });
  } catch (error) {
    console.error("[API] GET /orders/:id error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ GET /api/v1/logistics ============
apiRouter.get("/logistics", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize as string) || 100));
    const offset = (page - 1) * pageSize;
    const manager = req.query.manager as string | undefined;
    const client = req.query.client as string | undefined;
    const search = req.query.search as string | undefined;
    const dateFrom = req.query.dateFrom ? parseInt(req.query.dateFrom as string) : undefined;
    const dateTo = req.query.dateTo ? parseInt(req.query.dateTo as string) : undefined;

    const conditions: Array<ReturnType<typeof eq>> = [];
    const logisticsFilter = sql`${orderItems.code} = 'ВЛАСНА ЛОГІСТИКА'`;

    if (manager) conditions.push(like(orders.managerName, `%${manager}%`));
    if (client) conditions.push(like(orders.clientName, `%${client}%`));
    if (dateFrom) conditions.push(gte(orders.createdTs, dateFrom));
    if (dateTo) conditions.push(lte(orders.createdTs, dateTo));
    if (search) {
      conditions.push(
        or(
          like(orders.vortexOrderId, `%${search}%`),
          like(orders.clientName, `%${search}%`),
          like(orders.managerName, `%${search}%`),
          like(orderItems.description, `%${search}%`)
        ) as any
      );
    }

    const whereClause = conditions.length > 0
      ? and(...conditions, logisticsFilter)
      : logisticsFilter;

    const [countResult] = await db
      .select({ total: sql<number>`count(*)` })
      .from(orders)
      .innerJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
      .where(whereClause);

    const total = Number(countResult?.total || 0);

    const rows = await db
      .select({
        vortexOrderId: orders.vortexOrderId,
        clientName: orders.clientName,
        managerName: orders.managerName,
        currency: orders.currency,
        sumUah: orders.sumUah,
        deliveryName: orders.deliveryName,
        customerPhone: orders.customerPhone,
        trackNumber: orders.trackNumber,
        createdTs: orders.createdTs,
        code: orderItems.code,
        brandName: orderItems.brandName,
        description: orderItems.description,
        status: orderItems.status,
        qty: orderItems.qty,
        price: orderItems.price,
        basePrice: orderItems.basePrice,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orders.vortexOrderId, orderItems.vortexOrderId))
      .where(whereClause)
      .orderBy(desc(orders.createdTs))
      .limit(pageSize)
      .offset(offset);

    res.json({
      data: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("[API] GET /logistics error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ GET /api/v1/changes ============
apiRouter.get("/changes", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize as string) || 100));
    const offset = (page - 1) * pageSize;
    const changeType = req.query.changeType as string | undefined;
    const vortexOrderId = req.query.vortexOrderId as string | undefined;
    const syncBatchId = req.query.syncBatchId as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    const conditions: Array<ReturnType<typeof eq>> = [];
    if (changeType && changeType !== "all") {
      conditions.push(eq(changeLogs.changeType, changeType as "new" | "modified" | "deleted"));
    }
    if (vortexOrderId) {
      conditions.push(eq(changeLogs.vortexOrderId, vortexOrderId));
    }
    if (syncBatchId) {
      conditions.push(eq(changeLogs.syncBatchId, syncBatchId));
    }
    if (dateFrom) {
      conditions.push(gte(changeLogs.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      conditions.push(lte(changeLogs.createdAt, new Date(dateTo)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ total: sql<number>`count(*)` })
      .from(changeLogs)
      .where(whereClause);

    const rows = await db
      .select()
      .from(changeLogs)
      .where(whereClause)
      .orderBy(desc(changeLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    res.json({
      data: rows,
      total: Number(countResult?.total || 0),
      page,
      pageSize,
      totalPages: Math.ceil(Number(countResult?.total || 0) / pageSize),
    });
  } catch (error) {
    console.error("[API] GET /changes error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ GET /api/v1/sync/status ============
apiRouter.get("/sync/status", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const recentLogs = await db
      .select()
      .from(syncLogs)
      .orderBy(desc(syncLogs.startedAt))
      .limit(10);

    res.json({
      logs: recentLogs,
    });
  } catch (error) {
    console.error("[API] GET /sync/status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export { apiRouter };
