import { Router } from "express";
import { memoryAddSchema, memorySearchSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { memoryService } from "../services/memory.js";
import { agentService } from "../services/agents.js";
import type { Db } from "@paperclipai/db";

export function memoryRoutes(db: Db) {
  const router = Router();
  const apiKey = process.env.SUPERMEMORY_API_KEY?.trim() || null;
  const svc = memoryService({ apiKey });
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

    // Resolve scope
    const scopeType = req.body.scope ?? "agent";
    const projectId =
      scopeType === "project"
        ? (req.body.metadata?.projectId as string) ?? null
        : null;

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
    const scopes =
      scopeType === "agent"
        ? [{ companyId: agent.companyId, agentId: agent.id }]
        : scopeType === "company"
          ? [{ companyId: agent.companyId }]
          : scopeType === "project"
            ? [{ companyId: agent.companyId, projectId: (req.body.metadata?.projectId as string) ?? "" }]
            : [
                { companyId: agent.companyId, agentId: agent.id },
                { companyId: agent.companyId },
              ];

    const results = await svc.search({
      query: req.body.query,
      scopes,
      limit: req.body.limit,
    });

    res.json(results);
  });

  return router;
}
