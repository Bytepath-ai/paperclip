import { Router } from "express";
import { memoryAddSchema, memorySearchSchema, isUuidLike } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { memoryService } from "../services/memory.js";
import { agentService } from "../services/agents.js";
import type { Db } from "@paperclipai/db";

function extractProjectId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).projectId;
  return typeof raw === "string" && isUuidLike(raw) ? raw : null;
}

export function memoryRoutes(db: Db) {
  const router = Router();
  const svc = memoryService({ apiKey: process.env.SUPERMEMORY_API_KEY?.trim() || null });
  const agents = agentService(db);

  // POST /api/agents/:agentId/memory — store a memory
  router.post("/agents/:agentId/memory", validate(memoryAddSchema), async (req, res) => {
    if (!svc.isEnabled()) {
      res.status(503).json({ error: "Memory service not configured" });
      return;
    }

    const agentId = req.params.agentId as string;
    const agent = await agents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);

    const scopeType = req.body.scope ?? "agent";
    const projectId = scopeType === "project" ? extractProjectId(req.body.metadata) : null;

    const scope =
      scopeType === "company"
        ? { companyId: agent.companyId }
        : scopeType === "project" && projectId
          ? { companyId: agent.companyId, projectId }
          : { companyId: agent.companyId, agentId: agent.id };

    await svc.add({
      content: req.body.content,
      scope,
      metadata: {
        ...(req.body.metadata ?? {}),
        agentId: agent.id,
        addedAt: new Date().toISOString(),
      },
    });

    res.status(201).json({ ok: true });
  });

  // POST /api/agents/:agentId/memory/search — search memories
  router.post("/agents/:agentId/memory/search", validate(memorySearchSchema), async (req, res) => {
    if (!svc.isEnabled()) {
      res.status(503).json({ error: "Memory service not configured" });
      return;
    }

    const agentId = req.params.agentId as string;
    const agent = await agents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);

    const scopeType = req.body.scope ?? "all";
    const projectId = extractProjectId(req.body.metadata);

    let scopes: Array<{ companyId: string; agentId?: string; projectId?: string }>;
    if (scopeType === "agent") {
      scopes = [{ companyId: agent.companyId, agentId: agent.id }];
    } else if (scopeType === "company") {
      scopes = [{ companyId: agent.companyId }];
    } else if (scopeType === "project" && projectId) {
      scopes = [{ companyId: agent.companyId, projectId }];
    } else {
      // "all" — search agent + company + project (if available)
      scopes = [
        { companyId: agent.companyId, agentId: agent.id },
        { companyId: agent.companyId },
      ];
      if (projectId) {
        scopes.push({ companyId: agent.companyId, projectId });
      }
    }

    const results = await svc.search({
      query: req.body.query,
      scopes,
      limit: req.body.limit,
    });

    res.json(results);
  });

  // GET /api/agents/:agentId/memory — list recent memories
  router.get("/agents/:agentId/memory", async (req, res) => {
    if (!svc.isEnabled()) {
      res.status(503).json({ error: "Memory service not configured" });
      return;
    }

    const agentId = req.params.agentId as string;
    const agent = await agents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertBoard(req);
    assertCompanyAccess(req, agent.companyId);

    const scopeType = (req.query.scope as string) ?? "agent";
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 50);

    let scopes: Array<{ companyId: string; agentId?: string; projectId?: string }>;
    if (scopeType === "company") {
      scopes = [{ companyId: agent.companyId }];
    } else if (scopeType === "project") {
      const projectId = req.query.projectId as string | undefined;
      if (!projectId || !isUuidLike(projectId)) {
        res.status(400).json({ error: "projectId query parameter is required for scope=project" });
        return;
      }
      scopes = [{ companyId: agent.companyId, projectId }];
    } else {
      scopes = [{ companyId: agent.companyId, agentId: agent.id }];
    }

    const results = await svc.list({ scopes, limit });
    res.json(results);
  });

  // DELETE /api/agents/:agentId/memory — clear agent's memories
  router.delete("/agents/:agentId/memory", async (req, res) => {
    if (!svc.isEnabled()) {
      res.status(503).json({ error: "Memory service not configured" });
      return;
    }

    const agentId = req.params.agentId as string;
    const agent = await agents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertBoard(req);
    assertCompanyAccess(req, agent.companyId);

    // Supermemory SDK does not currently expose a delete/remove method
    res.status(501).json({
      error: "Memory deletion is not supported by the current memory provider (supermemory). Memories must be managed directly through the Supermemory dashboard.",
    });
  });

  return router;
}
