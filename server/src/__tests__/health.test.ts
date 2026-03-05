import { describe, it, expect } from "vitest";
import { healthRoutes } from "../routes/health.js";
import { invokeRouterPath } from "./helpers/http-mocks.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const { res } = await invokeRouterPath(healthRoutes(), {
      method: "get",
      path: "/",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
