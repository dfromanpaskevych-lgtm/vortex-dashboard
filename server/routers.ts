import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getOrdersList, getDashboardMetrics, getChangeLogs, getFilterOptions, getSyncLogsList, getLogisticsList } from "./db";
import { createApiKey, listApiKeys, revokeApiKey, deleteApiKey } from "./apiAuth";
import { createWebhook, listWebhooks, updateWebhook, deleteWebhook, type WebhookEvent } from "./webhookService";
import { syncOrders, syncOrdersChunked, getSyncStatus, startScheduledSync, getNextScheduledSyncTime, enrichBalances, getIsEnrichingBalances, cancelSync, isCancelPending } from "./syncService";

// Auto-sync: daily at 00:00 Kyiv time, last 7 days
startScheduledSync();

const WEBHOOK_EVENTS: WebhookEvent[] = [
  "order.created",
  "order.updated",
  "order.deleted",
  "item.status_changed",
  "item.price_changed",
  "sync.completed",
];

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  orders: router({
    list: publicProcedure
      .input(z.object({
        search: z.string().optional(),
        manager: z.string().optional(),
        status: z.string().optional(),
        brand: z.string().optional(),
        client: z.string().optional(),
        dateFrom: z.number().optional(),
        dateTo: z.number().optional(),
        qtyMin: z.number().optional(),
        qtyMax: z.number().optional(),
        basePriceCurrency: z.string().optional(),
        sortField: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getOrdersList(input || {});
      }),

    filterOptions: publicProcedure.query(async () => {
      return getFilterOptions();
    }),
  }),

  dashboard: router({
    metrics: publicProcedure.query(async () => {
      return getDashboardMetrics();
    }),
  }),

  changes: router({
    list: publicProcedure
      .input(z.object({
        page: z.number().optional(),
        pageSize: z.number().optional(),
        changeType: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getChangeLogs(
          input?.page || 1,
          input?.pageSize || 50,
          input?.changeType
        );
      }),
  }),

  logistics: router({
    list: publicProcedure
      .input(z.object({
        search: z.string().optional(),
        manager: z.string().optional(),
        client: z.string().optional(),
        dateFrom: z.number().optional(),
        dateTo: z.number().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getLogisticsList(input || {});
      }),
  }),

  sync: router({
    status: publicProcedure.query(async () => {
      const status = await getSyncStatus();
      return { ...status, nextScheduledSync: getNextScheduledSyncTime() };
    }),

    trigger: publicProcedure
      .input(z.object({
        days: z.number().optional(),
        dateFrom: z.number().optional(), // Unix timestamp (seconds)
        dateTo: z.number().optional(),   // Unix timestamp (seconds)
      }).optional())
      .mutation(async ({ input }) => {
        const days = input?.days || 3;
        const dateFrom = input?.dateFrom;
        const dateTo = input?.dateTo;

        // Calculate total days to decide chunking
        let totalDays = days;
        if (dateFrom && dateTo) {
          totalDays = Math.ceil((dateTo - dateFrom) / (60 * 60 * 24));
        }

        // Use chunked sync for all requests — each chunk gets its own log entry
        syncOrdersChunked(days, dateFrom, dateTo, "manual");

        const label = dateFrom && dateTo
          ? `${new Date(dateFrom * 1000).toLocaleDateString("uk-UA")} — ${new Date(dateTo * 1000).toLocaleDateString("uk-UA")}`
          : `останні ${days} дні`;
        const chunkCount = Math.ceil(totalDays / 7);
        return { started: true, message: `Синхронізацію запущено: ${label} (${chunkCount} ${chunkCount === 1 ? "чанк" : "чанків"} по 7 днів)` };
      }),

    logs: publicProcedure.query(async () => {
      return getSyncLogsList();
    }),

    enrichBalances: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const limit = input?.limit || 200;
        // Fire and forget
        enrichBalances(limit);
        return { started: true, message: `Збагачення балансами запущено (макс. ${limit} замовлень)` };
      }),

    balanceStatus: publicProcedure.query(() => {
      return { isEnriching: getIsEnrichingBalances() };
    }),

    cancel: publicProcedure.mutation(() => {
      return cancelSync();
    }),

    cancelPending: publicProcedure.query(() => {
      return { isCancelPending: isCancelPending() };
    }),
  }),

  // ============ API KEY MANAGEMENT ============
  apiKeys: router({
    list: protectedProcedure.query(async () => {
      return listApiKeys();
    }),

    create: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100) }))
      .mutation(async ({ input }) => {
        const result = await createApiKey(input.name);
        if (!result) throw new Error("Failed to create API key");
        return result; // { id, rawKey, prefix }
      }),

    revoke: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await revokeApiKey(input.id);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteApiKey(input.id);
        return { success: true };
      }),
  }),

  // ============ WEBHOOK MANAGEMENT ============
  webhooks: router({
    list: protectedProcedure.query(async () => {
      return listWebhooks();
    }),

    create: protectedProcedure
      .input(z.object({
        url: z.string().url(),
        events: z.array(z.string()).min(1),
      }))
      .mutation(async ({ input }) => {
        const result = await createWebhook(input.url, input.events as WebhookEvent[]);
        if (!result) throw new Error("Failed to create webhook");
        return result; // { id, secret }
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        url: z.string().url().optional(),
        events: z.array(z.string()).optional(),
        active: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateWebhook(id, data as { url?: string; events?: WebhookEvent[]; active?: boolean });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteWebhook(input.id);
        return { success: true };
      }),

    availableEvents: protectedProcedure.query(() => {
      return WEBHOOK_EVENTS;
    }),
  }),
});

export type AppRouter = typeof appRouter;
