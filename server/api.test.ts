import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createHash, randomBytes } from "crypto";
import { getDb } from "./db";
import { apiKeys, webhooks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

function createProtectedContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user-open-id",
      name: "Test User",
      email: "test@example.com",
      avatarUrl: null,
      role: "admin",
      createdAt: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ============ API KEYS ============
describe("apiKeys router", () => {
  let createdKeyId: number | null = null;

  it("creates an API key", async () => {
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.apiKeys.create({ name: "Test API Key" });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("rawKey");
    expect(result).toHaveProperty("prefix");
    expect(result.rawKey).toMatch(/^vx_/);
    expect(result.prefix.length).toBeGreaterThan(0);
    createdKeyId = result.id;
  });

  it("lists API keys", async () => {
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const keys = await caller.apiKeys.list();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    // Check key structure
    const key = keys.find((k) => k.id === createdKeyId);
    expect(key).toBeDefined();
    expect(key!.name).toBe("Test API Key");
    expect(key!.active).toBe(true);
    // Raw key should NOT be in list
    expect(key).not.toHaveProperty("rawKey");
  });

  it("revokes an API key", async () => {
    expect(createdKeyId).not.toBeNull();
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.apiKeys.revoke({ id: createdKeyId! });
    expect(result.success).toBe(true);

    // Verify it's deactivated
    const keys = await caller.apiKeys.list();
    const key = keys.find((k) => k.id === createdKeyId);
    expect(key).toBeDefined();
    expect(key!.active).toBe(false);
  });

  it("deletes an API key", async () => {
    expect(createdKeyId).not.toBeNull();
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.apiKeys.delete({ id: createdKeyId! });
    expect(result.success).toBe(true);

    // Verify it's gone
    const keys = await caller.apiKeys.list();
    const key = keys.find((k) => k.id === createdKeyId);
    expect(key).toBeUndefined();
  });
});

// ============ WEBHOOKS ============
describe("webhooks router", () => {
  let createdWebhookId: number | null = null;

  it("returns available events", async () => {
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const events = await caller.webhooks.availableEvents();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events).toContain("order.created");
    expect(events).toContain("order.updated");
    expect(events).toContain("item.status_changed");
    expect(events).toContain("item.price_changed");
    expect(events).toContain("sync.completed");
  });

  it("creates a webhook", async () => {
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.webhooks.create({
      url: "https://example.com/webhook-test",
      events: ["order.created", "order.updated"],
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("secret");
    expect(typeof result.id).toBe("number");
    expect(typeof result.secret).toBe("string");
    expect(result.secret.length).toBeGreaterThan(10);
    createdWebhookId = result.id;
  });

  it("lists webhooks", async () => {
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const list = await caller.webhooks.list();
    expect(Array.isArray(list)).toBe(true);
    const wh = list.find((w) => w.id === createdWebhookId);
    expect(wh).toBeDefined();
    expect(wh!.url).toBe("https://example.com/webhook-test");
    expect(wh!.active).toBe(true);
    expect(wh!.events).toContain("order.created");
    expect(wh!.events).toContain("order.updated");
  });

  it("updates a webhook (toggle active)", async () => {
    expect(createdWebhookId).not.toBeNull();
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.webhooks.update({
      id: createdWebhookId!,
      active: false,
    });
    expect(result.success).toBe(true);

    const list = await caller.webhooks.list();
    const wh = list.find((w) => w.id === createdWebhookId);
    expect(wh!.active).toBe(false);
  });

  it("updates a webhook (change URL)", async () => {
    expect(createdWebhookId).not.toBeNull();
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    await caller.webhooks.update({
      id: createdWebhookId!,
      url: "https://example.com/webhook-updated",
      active: true,
    });

    const list = await caller.webhooks.list();
    const wh = list.find((w) => w.id === createdWebhookId);
    expect(wh!.url).toBe("https://example.com/webhook-updated");
    expect(wh!.active).toBe(true);
  });

  it("deletes a webhook", async () => {
    expect(createdWebhookId).not.toBeNull();
    const ctx = createProtectedContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.webhooks.delete({ id: createdWebhookId! });
    expect(result.success).toBe(true);

    const list = await caller.webhooks.list();
    const wh = list.find((w) => w.id === createdWebhookId);
    expect(wh).toBeUndefined();
  });
});

// ============ API AUTH MIDDLEWARE ============
describe("API auth middleware", () => {
  it("validates API key format", async () => {
    // Import the validation function
    const { validateApiKey } = await import("./apiAuth");

    // Invalid format
    const result1 = await validateApiKey("invalid_key");
    expect(result1).toBe(false);

    // Valid format but non-existent
    const result2 = await validateApiKey("vx_" + randomBytes(32).toString("hex"));
    expect(result2).toBe(false);
  });

  it("validates a real API key", async () => {
    const { validateApiKey, createApiKey } = await import("./apiAuth");

    // Create a key
    const created = await createApiKey("Auth Test Key");
    expect(created).not.toBeNull();

    // Validate it
    const isValid = await validateApiKey(created!.rawKey);
    expect(isValid).toBe(true);

    // Clean up
    const { deleteApiKey } = await import("./apiAuth");
    await deleteApiKey(created!.id);
  });

  it("rejects revoked API key", async () => {
    const { validateApiKey, createApiKey, revokeApiKey, deleteApiKey } = await import("./apiAuth");

    const created = await createApiKey("Revoke Test Key");
    expect(created).not.toBeNull();

    // Revoke it
    await revokeApiKey(created!.id);

    // Should be invalid now
    const isValid = await validateApiKey(created!.rawKey);
    expect(isValid).toBe(false);

    // Clean up
    await deleteApiKey(created!.id);
  });
});

// ============ WEBHOOK SERVICE ============
describe("webhook service", () => {
  it("creates and lists webhooks via service", async () => {
    const { createWebhook, listWebhooks, deleteWebhook } = await import("./webhookService");

    const result = await createWebhook("https://test-service.com/hook", ["order.created"]);
    expect(result).not.toBeNull();
    expect(result!.id).toBeGreaterThan(0);
    expect(result!.secret.length).toBeGreaterThan(0);

    const list = await listWebhooks();
    const found = list.find((w) => w.id === result!.id);
    expect(found).toBeDefined();

    await deleteWebhook(result!.id);
  });
});
