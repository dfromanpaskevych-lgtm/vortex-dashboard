import { createHash, randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { apiKeys } from "../drizzle/schema";
import type { Request, Response, NextFunction } from "express";

/**
 * Hash an API key using SHA-256.
 */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a new API key.
 * Returns the raw key (shown once) and the hash (stored in DB).
 */
export function generateApiKey(): { rawKey: string; hash: string; prefix: string } {
  const rawKey = `vx_${randomBytes(32).toString("hex")}`;
  const hash = hashKey(rawKey);
  const prefix = rawKey.slice(0, 10);
  return { rawKey, hash, prefix };
}

/**
 * Create a new API key in the database.
 */
export async function createApiKey(name: string): Promise<{ id: number; rawKey: string; prefix: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const { rawKey, hash, prefix } = generateApiKey();
  const [result] = await db.insert(apiKeys).values({
    name,
    keyHash: hash,
    keyPrefix: prefix,
  });

  return { id: Number(result.insertId), rawKey, prefix };
}

/**
 * List all API keys (without hashes).
 */
export async function listApiKeys() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      active: apiKeys.active,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys);
}

/**
 * Revoke (deactivate) an API key.
 */
export async function revokeApiKey(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db.update(apiKeys).set({ active: false }).where(eq(apiKeys.id, id));
  return true;
}

/**
 * Delete an API key.
 */
export async function deleteApiKey(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  return true;
}

/**
 * Validate an API key from a request.
 * Returns true if valid, false otherwise.
 */
export async function validateApiKey(rawKey: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const hash = hashKey(rawKey);
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.active, true)))
    .limit(1);

  if (!key) return false;

  // Update last used timestamp (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {});

  return true;
}

/**
 * Express middleware: require valid API key in Authorization header.
 * Accepts: Authorization: Bearer vx_...
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Use: Bearer <api_key>",
    });
    return;
  }

  const token = authHeader.slice(7).trim();

  if (!token.startsWith("vx_")) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid API key format",
    });
    return;
  }

  validateApiKey(token)
    .then((valid) => {
      if (valid) {
        next();
      } else {
        res.status(403).json({
          error: "Forbidden",
          message: "Invalid or revoked API key",
        });
      }
    })
    .catch(() => {
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to validate API key",
      });
    });
}
