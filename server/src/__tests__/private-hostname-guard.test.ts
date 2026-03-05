import { describe, expect, it } from "vitest";
import { privateHostnameGuard } from "../middleware/private-hostname-guard.js";
import { invokeMiddleware } from "./helpers/http-mocks.js";

describe("privateHostnameGuard", () => {
  it("allows requests when disabled", async () => {
    const result = await invokeMiddleware(
      privateHostnameGuard({
        enabled: false,
        allowedHostnames: [],
        bindHost: "0.0.0.0",
      }),
      { method: "GET", path: "/api/health", headers: { host: "dotta-macbook-pro:3100" } },
    );
    expect(result.nextCalled).toBe(true);
  });

  it("allows loopback hostnames", async () => {
    const result = await invokeMiddleware(
      privateHostnameGuard({
        enabled: true,
        allowedHostnames: [],
        bindHost: "0.0.0.0",
      }),
      { method: "GET", path: "/api/health", headers: { host: "localhost:3100" } },
    );
    expect(result.nextCalled).toBe(true);
  });

  it("allows explicitly configured hostnames", async () => {
    const result = await invokeMiddleware(
      privateHostnameGuard({
        enabled: true,
        allowedHostnames: ["dotta-macbook-pro"],
        bindHost: "0.0.0.0",
      }),
      { method: "GET", path: "/api/health", headers: { host: "dotta-macbook-pro:3100" } },
    );
    expect(result.nextCalled).toBe(true);
  });

  it("blocks unknown hostnames with remediation command", async () => {
    const result = await invokeMiddleware(
      privateHostnameGuard({
        enabled: true,
        allowedHostnames: ["some-other-host"],
        bindHost: "0.0.0.0",
      }),
      { method: "GET", path: "/api/health", headers: { host: "dotta-macbook-pro:3100" } },
    );
    expect(result.res.statusCode).toBe(403);
    expect((result.res.body as { error: string }).error).toContain(
      "please run pnpm paperclipai allowed-hostname dotta-macbook-pro",
    );
  });

  it("blocks unknown hostnames on page routes with plain-text remediation command", async () => {
    const result = await invokeMiddleware(
      privateHostnameGuard({
        enabled: true,
        allowedHostnames: ["some-other-host"],
        bindHost: "0.0.0.0",
      }),
      { method: "GET", path: "/dashboard", headers: { host: "dotta-macbook-pro:3100", accept: "text/html" } },
    );
    expect(result.res.statusCode).toBe(403);
    expect(result.res.text).toContain("please run pnpm paperclipai allowed-hostname dotta-macbook-pro");
  });
});
