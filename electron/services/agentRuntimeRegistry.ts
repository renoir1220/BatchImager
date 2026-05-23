import type { AgentRuntime } from "./agentRuntime";

export interface AgentRuntimeFactory {
  (): Promise<AgentRuntime>;
}

export interface UseAgentRuntimeOptions {
  /** 缓存键，如 "chat:img-1" */
  key: string;
  /** 新建 runtime 时的工厂。 */
  factory: AgentRuntimeFactory;
  /** 仅在创建新 runtime 时调用一次，用于挂日志订阅等。 */
  onCreate?: (runtime: AgentRuntime) => void;
}

export interface UseAgentRuntimeContext {
  runtime: AgentRuntime;
  /** 本轮是否为新建 runtime 的首轮。caller 据此决定是否发完整 prompt。 */
  isFreshRuntime: boolean;
  /** 缓存 key。 */
  key: string;
  /** 当前 runtime 已成功处理过的 prompt 次数（首轮为 0）。 */
  turnCountBefore: number;
}

interface CachedEntry {
  runtime: AgentRuntime;
  turnCount: number;
  lastUsedAt: number;
  inflight: Promise<unknown>;
}

export interface AgentRuntimeRegistryOptions {
  maxEntries?: number;
  ttlMs?: number;
  /** 注入时钟，便于测试 TTL。 */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 16;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class AgentRuntimeRegistry {
  private readonly cache = new Map<string, CachedEntry>();
  private readonly pending = new Map<string, Promise<CachedEntry>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: AgentRuntimeRegistryOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * 取出（必要时新建）runtime，**同 key 串行执行 fn**，成功后 turnCount++ / bump lastUsedAt。
   *
   * 注意：registry 自己不会检测"用户清空了对话"这种语义，需要由 caller 在合适时机
   * 主动调用 invalidate(key)，下一次 use 即可拿到新建 runtime。
   *
   * runtime 的 dispose 统一由 registry 在淘汰/失效/turn 失败时调用，caller 不应自己 dispose。
   */
  async use<T>(options: UseAgentRuntimeOptions, fn: (ctx: UseAgentRuntimeContext) => Promise<T>): Promise<T> {
    this.pruneExpired();

    const entry = await this.getOrCreate(options);

    // 同 key 排队：把 fn 串到 inflight 链尾。并发的 use 调用会按到达顺序依次执行。
    const turn: Promise<T> = entry.inflight.then(() =>
      fn({
        runtime: entry.runtime,
        isFreshRuntime: entry.turnCount === 0,
        key: options.key,
        turnCountBefore: entry.turnCount
      })
    );
    entry.inflight = turn.catch(() => undefined);

    try {
      const result = await turn;
      entry.turnCount += 1;
      entry.lastUsedAt = this.now();
      this.evictIfOverCapacity(options.key);
      return result;
    } catch (error) {
      // 本轮失败：丢弃这个 runtime 避免 SDK 内部状态损坏被下轮继续复用。
      if (this.cache.get(options.key) === entry) {
        this.cache.delete(options.key);
        this.disposeCached(entry);
      }
      throw error;
    }
  }

  invalidate(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) {
      return;
    }

    this.cache.delete(key);
    this.disposeCached(entry);
  }

  invalidateAll(): void {
    for (const entry of this.cache.values()) {
      this.disposeCached(entry);
    }
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  private async getOrCreate(options: UseAgentRuntimeOptions): Promise<CachedEntry> {
    const existing = this.cache.get(options.key);
    if (existing) {
      return existing;
    }

    const pending = this.pending.get(options.key);
    if (pending) {
      return pending;
    }

    const creation = (async () => {
      const runtime = await options.factory();
      try {
        options.onCreate?.(runtime);
      } catch (error) {
        runtime.dispose();
        throw error;
      }
      const entry: CachedEntry = {
        runtime,
        turnCount: 0,
        lastUsedAt: this.now(),
        inflight: Promise.resolve()
      };
      this.cache.set(options.key, entry);
      return entry;
    })();
    this.pending.set(options.key, creation);

    try {
      return await creation;
    } finally {
      this.pending.delete(options.key);
    }
  }

  private pruneExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.cache) {
      if (entry.lastUsedAt < cutoff) {
        this.cache.delete(key);
        this.disposeCached(entry);
      }
    }
  }

  private evictIfOverCapacity(protectedKey: string): void {
    if (this.cache.size <= this.maxEntries) {
      return;
    }

    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.cache) {
      if (key === protectedKey) {
        continue;
      }
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt;
        oldestKey = key;
      }
    }

    if (oldestKey === undefined) {
      return;
    }

    const evicted = this.cache.get(oldestKey);
    if (evicted) {
      this.cache.delete(oldestKey);
      this.disposeCached(evicted);
    }
  }

  private disposeCached(entry: CachedEntry): void {
    try {
      entry.runtime.dispose();
    } catch {
      // 忽略 dispose 异常，避免影响其它清理流程。
    }
  }
}

let sharedRegistry: AgentRuntimeRegistry | undefined;

export function getSharedAgentRuntimeRegistry(): AgentRuntimeRegistry {
  if (!sharedRegistry) {
    sharedRegistry = new AgentRuntimeRegistry();
  }
  return sharedRegistry;
}

export function resetSharedAgentRuntimeRegistryForTests(): void {
  if (sharedRegistry) {
    sharedRegistry.invalidateAll();
  }
  sharedRegistry = undefined;
}
