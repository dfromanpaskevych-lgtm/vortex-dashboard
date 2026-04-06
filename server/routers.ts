import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getOrdersList, getDashboardMetrics, getChangeLogs, getFilterOptions, getSyncLogsList, getLogisticsList } from "./db";
import { syncOrders, getSyncStatus, startScheduledSync, enrichBalances, getIsEnrichingBalances } from "./syncService";

// Scheduled sync disabled — data loaded manually via load-march.mjs
// startScheduledSync();

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
      return getSyncStatus();
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
        // Fire and forget — runs day-by-day in background
        syncOrders(days, dateFrom, dateTo);
        const label = dateFrom && dateTo
          ? `${new Date(dateFrom * 1000).toLocaleDateString("uk-UA")} — ${new Date(dateTo * 1000).toLocaleDateString("uk-UA")}`
          : `останні ${days} дні`;
        return { started: true, message: `Синхронізацію запущено: ${label}` };
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
  }),
});

export type AppRouter = typeof appRouter;
