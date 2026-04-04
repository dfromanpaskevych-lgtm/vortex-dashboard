import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getOrdersList, getDashboardMetrics, getChangeLogs, getFilterOptions, getSyncLogsList } from "./db";
import { syncOrders, getSyncStatus, startScheduledSync } from "./syncService";

// Start scheduled sync on server boot
startScheduledSync();

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

  sync: router({
    status: publicProcedure.query(async () => {
      return getSyncStatus();
    }),

    trigger: publicProcedure
      .input(z.object({
        days: z.number().optional(),
      }).optional())
      .mutation(async ({ input }) => {
        // Run sync in background — default 3 days
        const days = input?.days || 3;
        syncOrders(days); // fire and forget
        return { started: true, message: `Sync started for last ${days} days` };
      }),

    logs: publicProcedure.query(async () => {
      return getSyncLogsList();
    }),
  }),
});

export type AppRouter = typeof appRouter;
