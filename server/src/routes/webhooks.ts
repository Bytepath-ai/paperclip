import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createWebhookSchema, isUuidLike } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { badRequest } from "../errors.js";
import { logActivity, webhookService } from "../services/index.js";

export function webhookRoutes(db: Db) {
  const router = Router();
  const svc = webhookService(db);

  router.get("/companies/:companyId/webhooks", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const webhooks = await svc.list(companyId);
    res.json(webhooks);
  });

  router.post(
    "/companies/:companyId/webhooks",
    validate(createWebhookSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const created = await svc.create(companyId, {
        url: req.body.url,
        events: req.body.events,
        description: req.body.description,
      });

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "webhook.created",
        entityType: "webhook",
        entityId: created.id,
        details: { url: created.url, events: created.events },
      });

      res.status(201).json(created);
    },
  );

  router.delete("/companies/:companyId/webhooks/:webhookId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const webhookId = req.params.webhookId as string;
    if (!isUuidLike(webhookId)) throw badRequest("Invalid webhook ID");

    const removed = await svc.remove(companyId, webhookId);
    if (!removed) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "webhook.deleted",
      entityType: "webhook",
      entityId: removed.id,
      details: { url: removed.url },
    });

    res.json({ ok: true });
  });

  return router;
}
