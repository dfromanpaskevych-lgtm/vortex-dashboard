import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, bigint, json, boolean } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Orders from Vortex ERP
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  vortexOrderId: varchar("vortexOrderId", { length: 32 }).notNull().unique(),
  clientId: varchar("clientId", { length: 32 }),
  clientName: text("clientName"),
  managerName: text("managerName"),
  currency: varchar("currency", { length: 10 }),
  clientNote: text("clientNote"),
  managerNote: text("managerNote"),
  sumUah: decimal("sumUah", { precision: 12, scale: 2 }),
  sumUsd: decimal("sumUsd", { precision: 12, scale: 2 }),
  sumEur: decimal("sumEur", { precision: 12, scale: 2 }),
  deliveryProvider: varchar("deliveryProvider", { length: 100 }),
  deliveryName: text("deliveryName"),
  customerPhone: varchar("customerPhone", { length: 30 }),
  trackNumber: varchar("trackNumber", { length: 64 }),
  cityName: varchar("cityName", { length: 100 }),
  instanceName: text("instanceName"),
  paymentName: varchar("paymentName", { length: 100 }),
  codAmount: decimal("codAmount", { precision: 12, scale: 2 }),
  codCurrency: varchar("codCurrency", { length: 10 }),
  balanceCurrencyTotal: decimal("balanceCurrencyTotal", { precision: 12, scale: 2 }),
  balanceCurrency: varchar("balanceCurrency", { length: 10 }),
  rawJson: json("rawJson"),
  createdTs: bigint("createdTs", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;

// Order items (line items within orders)
export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  vortexOrderId: varchar("vortexOrderId", { length: 32 }).notNull(),
  orderItemId: varchar("orderItemId", { length: 32 }),
  code: varchar("code", { length: 100 }),
  brandName: varchar("brandName", { length: 100 }),
  description: text("description"),
  status: varchar("status", { length: 30 }),
  whName: text("whName"),
  whId: varchar("whId", { length: 20 }),
  qty: int("qty"),
  price: decimal("price", { precision: 12, scale: 2 }),
  basePrice: decimal("basePrice", { precision: 12, scale: 2 }),
  basePriceCurrency: varchar("basePriceCurrency", { length: 10 }),
  retailPrice: decimal("retailPrice", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  deliveryTime: bigint("deliveryTime", { mode: "number" }),
  realDeliveryTime: bigint("realDeliveryTime", { mode: "number" }),
  deliveryName: text("deliveryName"),
  clientNote: text("clientNote"),
  managerNote: text("managerNote"),
  returnPeriod: varchar("returnPeriod", { length: 10 }),
  // RG (receipt/invoice) data from get_rg_list
  supplierName: text("supplierName"),
  supplierTotal: decimal("supplierTotal", { precision: 12, scale: 2 }),
  supplierCurrency: varchar("supplierCurrency", { length: 10 }),
  rgId: varchar("rgId", { length: 32 }),
  rgTimestamp: bigint("rgTimestamp", { mode: "number" }),
  // Currency exchange rate fixed at order creation date
  fixedRate: decimal("fixedRate", { precision: 10, scale: 4 }),
  fixedRateDate: varchar("fixedRateDate", { length: 10 }), // YYYY-MM-DD
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;

// Snapshots for change tracking
export const orderSnapshots = mysqlTable("order_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  vortexOrderId: varchar("vortexOrderId", { length: 32 }).notNull(),
  snapshotData: json("snapshotData").notNull(),
  syncBatchId: varchar("syncBatchId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Change log
export const changeLogs = mysqlTable("change_logs", {
  id: int("id").autoincrement().primaryKey(),
  vortexOrderId: varchar("vortexOrderId", { length: 32 }).notNull(),
  changeType: mysqlEnum("changeType", ["new", "modified", "deleted"]).notNull(),
  fieldName: varchar("fieldName", { length: 100 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  syncBatchId: varchar("syncBatchId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChangeLog = typeof changeLogs.$inferSelect;

// Sync log
export const syncLogs = mysqlTable("sync_logs", {
  id: int("id").autoincrement().primaryKey(),
  batchId: varchar("batchId", { length: 64 }).notNull().unique(),
  status: mysqlEnum("status", ["running", "completed", "failed", "cancelled"]).notNull(),
  syncType: mysqlEnum("syncType", ["manual", "auto"]).default("manual").notNull(),
  ordersProcessed: int("ordersProcessed").default(0),
  itemsProcessed: int("itemsProcessed").default(0),
  newOrders: int("newOrders").default(0),
  modifiedOrders: int("modifiedOrders").default(0),
  deletedOrders: int("deletedOrders").default(0),
  errorMessage: text("errorMessage"),
  dateFrom: varchar("dateFrom", { length: 10 }),  // YYYY-MM-DD
  dateTo: varchar("dateTo", { length: 10 }),      // YYYY-MM-DD
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type SyncLog = typeof syncLogs.$inferSelect;

// API Keys for external access
export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  keyHash: varchar("keyHash", { length: 128 }).notNull().unique(),
  keyPrefix: varchar("keyPrefix", { length: 12 }).notNull(), // first 8 chars for display
  active: boolean("active").default(true).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;

// Webhooks for push notifications
export const webhooks = mysqlTable("webhooks", {
  id: int("id").autoincrement().primaryKey(),
  url: text("url").notNull(),
  secret: varchar("secret", { length: 128 }).notNull(), // HMAC signing secret
  events: json("events").notNull(), // ["order.created", "order.updated", "item.updated"]
  active: boolean("active").default(true).notNull(),
  lastDeliveredAt: timestamp("lastDeliveredAt"),
  lastStatus: int("lastStatus"), // HTTP status of last delivery
  failCount: int("failCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Webhook = typeof webhooks.$inferSelect;

// Currency rates cache
export const currencyRates = mysqlTable("currency_rates", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  currency: varchar("currency", { length: 5 }).notNull(), // USD, EUR
  rate: decimal("rate", { precision: 10, scale: 4 }).notNull(),
  source: varchar("source", { length: 20 }).notNull(), // monobank, nbu
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CurrencyRate = typeof currencyRates.$inferSelect;
