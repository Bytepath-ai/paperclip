import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns, agentWakeupRequests, costEvents } from "@paperclipai/db";
import { memoryService } from "../services/memory.js";
import { assertBoard } from "./authz.js";

interface MetricsConfig {
  heartbeatSchedulerEnabled: boolean;
  heartbeatSchedulerIntervalMs: number;
  supermemoryApiKey: string | null;
}

export function metricsRoutes(db: Db, config: MetricsConfig) {
  const router = Router();

  // GET /api/health/detailed — subsystem health check
  router.get("/health/detailed", async (req, res) => {
    assertBoard(req);
    const startTime = process.uptime();

    // Check database
    let dbStatus: { status: string; latencyMs: number } = { status: "error", latencyMs: 0 };
    try {
      const t0 = Date.now();
      await db.execute(sql`SELECT 1`);
      dbStatus = { status: "ok", latencyMs: Date.now() - t0 };
    } catch {
      dbStatus = { status: "error", latencyMs: 0 };
    }

    // Check memory service
    const memorySvc = memoryService({ apiKey: config.supermemoryApiKey });
    const memoryStatus = {
      status: memorySvc.isEnabled() ? "ok" : "disabled",
      provider: "supermemory",
    };

    // Scheduler config
    const schedulerStatus = {
      status: config.heartbeatSchedulerEnabled ? "ok" : "disabled",
      enabled: config.heartbeatSchedulerEnabled,
      intervalMs: config.heartbeatSchedulerIntervalMs,
    };

    const overall =
      dbStatus.status === "ok" ? "ok" : "degraded";

    res.json({
      status: overall,
      subsystems: {
        database: dbStatus,
        scheduler: schedulerStatus,
        memory: memoryStatus,
      },
      version: "0.2.5",
      uptime: Math.round(startTime),
    });
  });

  // GET /api/metrics — Prometheus-format metrics
  router.get("/metrics", async (req, res) => {
    assertBoard(req);
    try {
      const [agentCounts, heartbeatCounts, [wakeupRow], [costRow]] = await Promise.all([
        // Agent counts by status
        db
          .select({ status: agents.status, count: sql<number>`count(*)::int` })
          .from(agents)
          .groupBy(agents.status),
        // Heartbeat run counts by status (only active: queued, running)
        db
          .select({ status: heartbeatRuns.status, count: sql<number>`count(*)::int` })
          .from(heartbeatRuns)
          .where(sql`${heartbeatRuns.status} IN ('queued', 'running')`)
          .groupBy(heartbeatRuns.status),
        // Pending wakeup requests
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(agentWakeupRequests)
          .where(sql`${agentWakeupRequests.status} = 'queued'`),
        // Monthly cost — sum cost_cents for current month
        db
          .select({ total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int` })
          .from(costEvents)
          .where(sql`${costEvents.occurredAt} >= date_trunc('month', now())`),
      ]);

      const agentMap: Record<string, number> = { idle: 0, running: 0, paused: 0, error: 0 };
      for (const row of agentCounts) {
        agentMap[row.status] = row.count;
      }

      const heartbeatMap: Record<string, number> = { queued: 0, running: 0 };
      for (const row of heartbeatCounts) {
        heartbeatMap[row.status] = row.count;
      }

      const pendingWakeups = wakeupRow?.count ?? 0;
      const monthlyCostCents = costRow?.total ?? 0;

      const lines = [
        "# HELP paperclip_agents_total Total agents by status",
        "# TYPE paperclip_agents_total gauge",
        ...Object.entries(agentMap).map(
          ([status, count]) => `paperclip_agents_total{status="${status}"} ${count}`,
        ),
        "# HELP paperclip_heartbeat_runs_total Heartbeat runs by status",
        "# TYPE paperclip_heartbeat_runs_total gauge",
        ...Object.entries(heartbeatMap).map(
          ([status, count]) => `paperclip_heartbeat_runs_total{status="${status}"} ${count}`,
        ),
        "# HELP paperclip_wakeup_requests_pending Pending wakeup requests",
        "# TYPE paperclip_wakeup_requests_pending gauge",
        `paperclip_wakeup_requests_pending ${pendingWakeups}`,
        "# HELP paperclip_cost_monthly_cents Total monthly spend across all agents",
        "# TYPE paperclip_cost_monthly_cents gauge",
        `paperclip_cost_monthly_cents ${monthlyCostCents}`,
      ];

      res.set("Content-Type", "text/plain; charset=utf-8").send(lines.join("\n") + "\n");
    } catch (err) {
      res.status(500).set("Content-Type", "text/plain").send("# error fetching metrics\n");
    }
  });

  return router;
}
