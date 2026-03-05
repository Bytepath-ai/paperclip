import { logger } from "../middleware/logger.js";

export interface MemoryConfig {
  apiKey: string | null;
}

interface MemoryScope {
  companyId: string;
  agentId?: string;
  projectId?: string;
}

interface MemorySearchOpts {
  query: string;
  scopes: MemoryScope[];
  limit?: number;
  threshold?: number;
}

interface MemoryResult {
  content: string;
  score: number;
  containerTag: string;
  metadata?: Record<string, unknown>;
}

interface MemorySearchResult {
  results: MemoryResult[];
}

interface MemoryAddOpts {
  content: string;
  scope: MemoryScope;
  metadata?: Record<string, unknown>;
}

export interface MemoryServiceInstance {
  isEnabled(): boolean;
  search(opts: MemorySearchOpts): Promise<MemorySearchResult>;
  add(opts: MemoryAddOpts): Promise<void>;
  buildContainerTag(scope: MemoryScope): string;
}

const MEMORY_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("supermemory timeout")), ms),
    ),
  ]);
}

// Singleton instance — created once, shared across all consumers
let singleton: MemoryServiceInstance | null = null;

export function memoryService(config: MemoryConfig): MemoryServiceInstance {
  if (singleton) return singleton;

  const enabled = !!config.apiKey;
  let client: any = null;
  let ready: Promise<void> = Promise.resolve();

  if (enabled) {
    ready = import("supermemory")
      .then((mod) => {
        const Supermemory = mod.default ?? mod;
        client = new Supermemory({ apiKey: config.apiKey! });
        logger.info("supermemory client initialized");
      })
      .catch((err) => {
        logger.warn({ err }, "supermemory SDK not available — memory disabled");
      });
  }

  function buildContainerTag(scope: MemoryScope): string {
    if (scope.projectId) return `company_${scope.companyId}_project_${scope.projectId}`;
    if (scope.agentId) return `company_${scope.companyId}_agent_${scope.agentId}`;
    return `company_${scope.companyId}`;
  }

  singleton = {
    isEnabled: () => enabled,

    async search(opts: MemorySearchOpts): Promise<MemorySearchResult> {
      await ready;
      if (!client) return { results: [] };
      try {
        const allResults: MemoryResult[] = [];
        const searchPromises = opts.scopes.map(async (scope) => {
          const tag = buildContainerTag(scope);
          const resp = await client.search.documents({
            q: opts.query,
            containerTag: tag,
            limit: opts.limit ?? 5,
            threshold: opts.threshold ?? 0.6,
          });
          const results = resp?.results ?? [];
          for (const doc of results) {
            allResults.push({
              content: doc.content ?? doc.memory ?? doc.chunk ?? "",
              metadata: doc.metadata,
              score: doc.similarity ?? doc.score ?? 0,
              containerTag: tag,
            });
          }
        });
        await withTimeout(Promise.all(searchPromises), MEMORY_TIMEOUT_MS);
        allResults.sort((a, b) => b.score - a.score);
        return { results: allResults.slice(0, opts.limit ?? 10) };
      } catch (err) {
        logger.warn({ err }, "supermemory search failed");
        return { results: [] };
      }
    },

    async add(opts: MemoryAddOpts): Promise<void> {
      await ready;
      if (!client) return;
      try {
        const tag = buildContainerTag(opts.scope);
        await withTimeout(
          client.add({
            content: opts.content,
            containerTag: tag,
            metadata: opts.metadata,
          }),
          MEMORY_TIMEOUT_MS,
        );
      } catch (err) {
        logger.warn({ err }, "supermemory add failed");
      }
    },

    buildContainerTag,
  };

  return singleton;
}
