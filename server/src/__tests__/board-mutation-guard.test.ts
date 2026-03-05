import { describe, expect, it } from "vitest";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { invokeMiddleware } from "./helpers/http-mocks.js";

describe("boardMutationGuard", () => {
  it("allows safe methods for board actor", async () => {
    const result = await invokeMiddleware(boardMutationGuard(), {
      method: "GET",
      path: "/read",
      actor: { type: "board", userId: "board", source: "session" },
    });
    expect(result.nextCalled).toBe(true);
    expect(result.res.finished).toBe(false);
  });

  it("blocks board mutations without trusted origin", async () => {
    const result = await invokeMiddleware(boardMutationGuard(), {
      method: "POST",
      path: "/mutate",
      actor: { type: "board", userId: "board", source: "session" },
      body: { ok: true },
    });
    expect(result.res.statusCode).toBe(403);
    expect(result.res.body).toEqual({ error: "Board mutation requires trusted browser origin" });
  });

  it("allows local implicit board mutations without origin", async () => {
    const result = await invokeMiddleware(boardMutationGuard(), {
      method: "POST",
      path: "/mutate",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      body: { ok: true },
    });
    expect(result.nextCalled).toBe(true);
  });

  it("allows board mutations from trusted origin", async () => {
    const result = await invokeMiddleware(boardMutationGuard(), {
      method: "POST",
      path: "/mutate",
      headers: { origin: "http://localhost:3100", host: "localhost:3100" },
      actor: { type: "board", userId: "board", source: "session" },
      body: { ok: true },
    });
    expect(result.nextCalled).toBe(true);
  });

  it("allows board mutations from trusted referer origin", async () => {
    const result = await invokeMiddleware(boardMutationGuard(), {
      method: "POST",
      path: "/mutate",
      headers: { referer: "http://localhost:3100/issues/abc", host: "localhost:3100" },
      actor: { type: "board", userId: "board", source: "session" },
      body: { ok: true },
    });
    expect(result.nextCalled).toBe(true);
  });

  it("does not block authenticated agent mutations", async () => {
    const result = await invokeMiddleware(boardMutationGuard(), {
      method: "POST",
      path: "/mutate",
      actor: { type: "agent", agentId: "agent-1" },
      body: { ok: true },
    });
    expect(result.nextCalled).toBe(true);
  });
});
