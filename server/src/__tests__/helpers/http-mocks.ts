export type MockRequestInit = {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  actor?: Record<string, unknown>;
};

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  text: string;
  finished: boolean;
  locals: Record<string, unknown>;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
  send(payload: unknown): MockResponse;
  end(payload?: unknown): MockResponse;
  set(name: string, value: string): MockResponse;
  type(value: string): MockResponse;
  getHeader(name: string): string | undefined;
  setHeader(name: string, value: string): void;
};

function normalizeHeaders(headers: Record<string, string> | undefined) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

export function createMockRequest(init: MockRequestInit = {}) {
  const headers = normalizeHeaders(init.headers);

  return {
    method: (init.method ?? "GET").toUpperCase(),
    url: init.path ?? "/",
    originalUrl: init.path ?? "/",
    path: init.path ?? "/",
    params: { ...(init.params ?? {}) },
    query: { ...(init.query ?? {}) },
    body: init.body ?? {},
    headers,
    actor: init.actor ?? { type: "none" },
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    get(name: string) {
      return headers[name.toLowerCase()];
    },
    accepts(types: string[]) {
      const accept = headers.accept?.toLowerCase() ?? "";
      if (accept.includes("json") && types.includes("json")) return "json";
      if (accept.includes("html") && types.includes("html")) return "html";
      if (accept.includes("text") && types.includes("text")) return "text";
      return types[0] ?? false;
    },
  };
}

export function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    text: "",
    finished: false,
    locals: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.finished = true;
      return this;
    },
    send(payload: unknown) {
      if (typeof payload === "string") {
        this.text = payload;
      } else {
        this.body = payload;
      }
      this.finished = true;
      return this;
    },
    end(payload?: unknown) {
      if (typeof payload === "string") {
        this.text = payload;
      } else if (payload !== undefined) {
        this.body = payload;
      }
      this.finished = true;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    type(value: string) {
      this.headers["content-type"] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
  };
}

export async function invokeMiddleware(
  handler: (req: any, res: any, next: (err?: unknown) => void) => unknown,
  init: MockRequestInit = {},
) {
  const req = createMockRequest(init);
  const res = createMockResponse();
  let nextCalled = false;
  let nextError: unknown;

  const next = (err?: unknown) => {
    nextCalled = true;
    nextError = err;
  };

  try {
    await Promise.resolve(handler(req, res, next));
  } catch (err) {
    nextError = err;
  }

  return { req, res, nextCalled, nextError };
}

export async function invokeRouterPath(
  router: any,
  input: MockRequestInit & { method: "get" | "post" | "patch" | "delete"; path: string },
) {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === input.path && entry.route.methods[input.method],
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${input.method.toUpperCase()} ${input.path}`);
  }

  const req = createMockRequest(input);
  const res = createMockResponse();

  for (const routeLayer of layer.route.stack) {
    if (res.finished) break;
    let nextError: unknown;
    const next = (err?: unknown) => {
      nextError = err;
    };

    try {
      await Promise.resolve(routeLayer.handle(req, res, next));
    } catch (err) {
      nextError = err;
    }

    if (nextError) {
      return { req, res, error: nextError };
    }
  }

  return { req, res, error: null };
}
