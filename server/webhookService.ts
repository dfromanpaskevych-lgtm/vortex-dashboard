import { createHmac } from "crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { webhooks } from "../drizzle/schema";
import { randomBytes } from "crypto";

export type WebhookEvent =
  | "order.created"
  | "order.updated"
  | "order.deleted"
  | "item.status_changed"
  | "item.price_changed"
  | "sync.completed";

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Generate a webhook signing secret.
 */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/**
 * Create a new webhook.
 */
export async function createWebhook(
  url: string,
  events: WebhookEvent[]
): Promise<{ id: number; secret: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const secret = generateWebhookSecret();
  const [result] = await db.insert(webhooks).values({
    url,
    secret,
    events: events,
    active: true,
    failCount: 0,
  });

  return { id: Number(result.insertId), secret };
}

/**
 * List all webhooks (with secrets masked).
 */
export async function listWebhooks() {
  const db = await getDb();
  if (!db) return [];

  const rows = await db.select().from(webhooks);
  return rows.map((w) => ({
    ...w,
    secret: w.secret.slice(0, 10) + "...",
  }));
}

/**
 * Update webhook.
 */
export async function updateWebhook(
  id: number,
  data: { url?: string; events?: WebhookEvent[]; active?: boolean }
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const updateData: Record<string, unknown> = {};
  if (data.url !== undefined) updateData.url = data.url;
  if (data.events !== undefined) updateData.events = data.events;
  if (data.active !== undefined) updateData.active = data.active;

  if (Object.keys(updateData).length === 0) return false;

  await db.update(webhooks).set(updateData).where(eq(webhooks.id, id));
  return true;
}

/**
 * Delete a webhook.
 */
export async function deleteWebhook(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db.delete(webhooks).where(eq(webhooks.id, id));
  return true;
}

/**
 * Sign a payload with HMAC-SHA256.
 */
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Deliver a webhook event to all matching active webhooks.
 * Non-blocking: fires and forgets, logs errors.
 */
export async function fireWebhookEvent(
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Get all active webhooks
  const activeWebhooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.active, true));

  if (activeWebhooks.length === 0) return;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const payloadStr = JSON.stringify(payload);

  // Deliver to each matching webhook in parallel
  const deliveries = activeWebhooks
    .filter((wh) => {
      const events = (wh.events as WebhookEvent[]) || [];
      return events.includes(event) || events.includes("*" as WebhookEvent);
    })
    .map(async (wh) => {
      const signature = signPayload(payloadStr, wh.secret);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(wh.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Event": event,
            "X-Webhook-Timestamp": payload.timestamp,
          },
          body: payloadStr,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        // Update delivery status
        await db
          .update(webhooks)
          .set({
            lastDeliveredAt: new Date(),
            lastStatus: response.status,
            failCount: response.ok ? 0 : (wh.failCount || 0) + 1,
          })
          .where(eq(webhooks.id, wh.id));

        if (!response.ok) {
          console.error(
            `[Webhook] Delivery failed to ${wh.url}: HTTP ${response.status}`
          );
        } else {
          console.log(`[Webhook] Delivered ${event} to ${wh.url}: HTTP ${response.status}`);
        }

        // Auto-disable after 10 consecutive failures
        if (!response.ok && (wh.failCount || 0) + 1 >= 10) {
          console.warn(`[Webhook] Disabling webhook ${wh.id} after 10 failures`);
          await db
            .update(webhooks)
            .set({ active: false })
            .where(eq(webhooks.id, wh.id));
        }
      } catch (err) {
        console.error(
          `[Webhook] Delivery error to ${wh.url}:`,
          err instanceof Error ? err.message : String(err)
        );

        await db
          .update(webhooks)
          .set({
            lastDeliveredAt: new Date(),
            lastStatus: 0,
            failCount: (wh.failCount || 0) + 1,
          })
          .where(eq(webhooks.id, wh.id))
          .catch(() => {});

        // Auto-disable after 10 consecutive failures
        if ((wh.failCount || 0) + 1 >= 10) {
          console.warn(`[Webhook] Disabling webhook ${wh.id} after 10 failures`);
          await db
            .update(webhooks)
            .set({ active: false })
            .where(eq(webhooks.id, wh.id))
            .catch(() => {});
        }
      }
    });

  // Don't await all — fire and forget
  Promise.allSettled(deliveries).catch(() => {});
}

/**
 * Batch fire webhook events for sync results.
 * Called at the end of syncOrders with aggregated changes.
 */
export async function fireSyncWebhooks(
  syncResult: {
    batchId: string;
    newOrders: Array<{ vortexOrderId: string; clientName: string; managerName: string; items: number }>;
    modifiedOrders: Array<{ vortexOrderId: string; changes: Array<{ field: string; oldVal: string; newVal: string }> }>;
  }
): Promise<void> {
  // Fire order.created for each new order
  for (const order of syncResult.newOrders) {
    await fireWebhookEvent("order.created", {
      vortexOrderId: order.vortexOrderId,
      clientName: order.clientName,
      managerName: order.managerName,
      itemCount: order.items,
      syncBatchId: syncResult.batchId,
    });
  }

  // Fire order.updated for each modified order
  for (const order of syncResult.modifiedOrders) {
    // Check if there are price or status changes specifically
    const priceChanges = order.changes.filter(
      (c) => c.field.includes("price") || c.field.includes("Price")
    );
    const statusChanges = order.changes.filter(
      (c) => c.field.includes("status")
    );

    await fireWebhookEvent("order.updated", {
      vortexOrderId: order.vortexOrderId,
      changes: order.changes,
      syncBatchId: syncResult.batchId,
    });

    // Also fire specific events
    if (priceChanges.length > 0) {
      await fireWebhookEvent("item.price_changed", {
        vortexOrderId: order.vortexOrderId,
        priceChanges,
        syncBatchId: syncResult.batchId,
      });
    }

    if (statusChanges.length > 0) {
      await fireWebhookEvent("item.status_changed", {
        vortexOrderId: order.vortexOrderId,
        statusChanges,
        syncBatchId: syncResult.batchId,
      });
    }
  }

  // Fire sync.completed summary
  await fireWebhookEvent("sync.completed", {
    batchId: syncResult.batchId,
    newOrdersCount: syncResult.newOrders.length,
    modifiedOrdersCount: syncResult.modifiedOrders.length,
    timestamp: new Date().toISOString(),
  });
}
