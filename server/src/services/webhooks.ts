import crypto from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyWebhooks } from "@paperclipai/db";
import type { WebhookEvent } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { unprocessable } from "../errors.js";

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_WEBHOOKS_PER_COMPANY = 20;

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
];

export function isPrivateUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true; // treat unparseable URLs as private/blocked
  }
  if (url.protocol !== "https:") return true;
  return PRIVATE_HOSTNAME_PATTERNS.some((p) => p.test(url.hostname));
}

function sign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function webhookService(db: Db) {
  async function list(companyId: string) {
    return db
      .select({
        id: companyWebhooks.id,
        companyId: companyWebhooks.companyId,
        url: companyWebhooks.url,
        events: companyWebhooks.events,
        active: companyWebhooks.active,
        description: companyWebhooks.description,
        lastDeliveryAt: companyWebhooks.lastDeliveryAt,
        lastDeliveryStatus: companyWebhooks.lastDeliveryStatus,
        createdAt: companyWebhooks.createdAt,
        updatedAt: companyWebhooks.updatedAt,
      })
      .from(companyWebhooks)
      .where(eq(companyWebhooks.companyId, companyId));
  }

  async function create(
    companyId: string,
    input: { url: string; events: string[]; description?: string },
  ) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(companyWebhooks)
      .where(eq(companyWebhooks.companyId, companyId));
    if (count >= MAX_WEBHOOKS_PER_COMPANY) {
      throw unprocessable(`Company webhook limit reached (max ${MAX_WEBHOOKS_PER_COMPANY})`);
    }

    const secret = crypto.randomBytes(32).toString("hex");
    const rows = await db
      .insert(companyWebhooks)
      .values({
        companyId,
        url: input.url,
        secret,
        events: input.events,
        active: true,
        description: input.description ?? null,
      })
      .returning();
    return rows[0];
  }

  async function remove(companyId: string, webhookId: string) {
    const rows = await db
      .delete(companyWebhooks)
      .where(
        and(
          eq(companyWebhooks.id, webhookId),
          eq(companyWebhooks.companyId, companyId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async function dispatch(
    companyId: string,
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ) {
    const hooks = await db
      .select()
      .from(companyWebhooks)
      .where(
        and(
          eq(companyWebhooks.companyId, companyId),
          eq(companyWebhooks.active, true),
        ),
      );

    const matching = hooks.filter((h) => {
      const events = h.events as string[];
      return events.includes(event);
    });

    for (const hook of matching) {
      if (isPrivateUrl(hook.url)) {
        logger.warn({ webhookId: hook.id, url: hook.url }, "skipping webhook with private/non-HTTPS URL");
        continue;
      }

      const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
      const signature = sign(hook.secret, body);

      fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Paperclip-Signature": signature,
          "X-Paperclip-Event": event,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
        .then(async (res) => {
          const status = `${res.status} ${res.statusText}`;
          await db
            .update(companyWebhooks)
            .set({ lastDeliveryAt: new Date(), lastDeliveryStatus: status, updatedAt: new Date() })
            .where(eq(companyWebhooks.id, hook.id));
          logger.debug({ webhookId: hook.id, event, status }, "webhook delivered");
        })
        .catch(async (err) => {
          const status = `error: ${(err as Error).message}`;
          await db
            .update(companyWebhooks)
            .set({ lastDeliveryAt: new Date(), lastDeliveryStatus: status, updatedAt: new Date() })
            .where(eq(companyWebhooks.id, hook.id));
          logger.warn({ webhookId: hook.id, event, err: (err as Error).message }, "webhook delivery failed");
        })
        .catch((innerErr) => {
          logger.error({ innerErr, webhookId: hook.id, event }, "webhook delivery update failed");
        });
    }
  }

  return { list, create, remove, dispatch };
}
