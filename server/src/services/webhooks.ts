import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyWebhooks } from "@paperclipai/db";
import type { WebhookEvent } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";

const DELIVERY_TIMEOUT_MS = 5_000;

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
        });
    }
  }

  return { list, create, remove, dispatch };
}
