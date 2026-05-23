import { describe, expect, test } from "vitest";
import type { AgentRuntime } from "./agentRuntime";
import { AgentRuntimeRegistry } from "./agentRuntimeRegistry";

interface FakeRuntimeState {
  disposeCalls: number;
}

function createFakeRuntime(state: FakeRuntimeState): AgentRuntime {
  return {
    descriptor: {
      builtInTools: [],
      customTools: [],
      model: "test",
      projectDirectory: "C:\\proj",
      sessionId: "sess"
    },
    dispose: () => {
      state.disposeCalls += 1;
    },
    getLastAssistantText: () => "ok",
    prompt: async () => undefined,
    subscribe: () => () => undefined
  };
}

describe("AgentRuntimeRegistry", () => {
  test("creates a runtime on first use and reuses it on the next call", async () => {
    const registry = new AgentRuntimeRegistry();
    const state: FakeRuntimeState = { disposeCalls: 0 };
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      return createFakeRuntime(state);
    };

    const first = await registry.use({ key: "k", factory }, async (ctx) => ({ isFresh: ctx.isFreshRuntime, turnBefore: ctx.turnCountBefore }));
    const second = await registry.use({ key: "k", factory }, async (ctx) => ({ isFresh: ctx.isFreshRuntime, turnBefore: ctx.turnCountBefore }));

    expect(first).toEqual({ isFresh: true, turnBefore: 0 });
    expect(second).toEqual({ isFresh: false, turnBefore: 1 });
    expect(factoryCalls).toBe(1);
    expect(state.disposeCalls).toBe(0);
  });

  test("invalidate disposes the cached runtime and forces a rebuild on next use", async () => {
    const registry = new AgentRuntimeRegistry();
    const states: FakeRuntimeState[] = [];
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      const state: FakeRuntimeState = { disposeCalls: 0 };
      states.push(state);
      return createFakeRuntime(state);
    };

    await registry.use({ key: "k", factory }, async () => undefined);
    registry.invalidate("k");
    await registry.use({ key: "k", factory }, async (ctx) => {
      expect(ctx.isFreshRuntime).toBe(true);
    });

    expect(factoryCalls).toBe(2);
    expect(states[0].disposeCalls).toBe(1);
  });

  test("serializes concurrent prompts on the same key and only builds the runtime once", async () => {
    const registry = new AgentRuntimeRegistry();
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      return createFakeRuntime({ disposeCalls: 0 });
    };
    const order: string[] = [];

    const work = async (label: string, delayMs: number) => {
      order.push(`start:${label}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      order.push(`end:${label}`);
    };

    const first = registry.use({ key: "k", factory }, () => work("a", 30));
    const second = registry.use({ key: "k", factory }, () => work("b", 5));

    await Promise.all([first, second]);

    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
    expect(factoryCalls).toBe(1);
  });

  test("invalidateAll disposes every cached runtime", async () => {
    const registry = new AgentRuntimeRegistry();
    const stateA: FakeRuntimeState = { disposeCalls: 0 };
    const stateB: FakeRuntimeState = { disposeCalls: 0 };
    let counter = 0;
    const factory = async () => createFakeRuntime(counter++ === 0 ? stateA : stateB);

    await registry.use({ key: "a", factory }, async () => undefined);
    await registry.use({ key: "b", factory }, async () => undefined);
    registry.invalidateAll();

    expect(stateA.disposeCalls).toBe(1);
    expect(stateB.disposeCalls).toBe(1);
    expect(registry.size()).toBe(0);
  });

  test("evicts the least-recently-used entry when capacity is exceeded", async () => {
    const registry = new AgentRuntimeRegistry({ maxEntries: 2 });
    const states = new Map<string, FakeRuntimeState>();
    const factory = (key: string) => async () => {
      const state: FakeRuntimeState = { disposeCalls: 0 };
      states.set(key, state);
      return createFakeRuntime(state);
    };

    await registry.use({ key: "a", factory: factory("a") }, async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await registry.use({ key: "b", factory: factory("b") }, async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await registry.use({ key: "c", factory: factory("c") }, async () => undefined);

    expect(registry.has("a")).toBe(false);
    expect(registry.has("b")).toBe(true);
    expect(registry.has("c")).toBe(true);
    expect(states.get("a")?.disposeCalls).toBe(1);
  });

  test("prunes entries past TTL on the next use", async () => {
    let nowValue = 1_000;
    const registry = new AgentRuntimeRegistry({ ttlMs: 100, now: () => nowValue });
    const states: FakeRuntimeState[] = [];
    const factory = async () => {
      const state: FakeRuntimeState = { disposeCalls: 0 };
      states.push(state);
      return createFakeRuntime(state);
    };

    await registry.use({ key: "k", factory }, async () => undefined);
    nowValue += 200;
    await registry.use({ key: "other", factory }, async () => undefined);

    expect(registry.has("k")).toBe(false);
    expect(states[0].disposeCalls).toBe(1);
  });

  test("drops the runtime when the work function throws", async () => {
    const registry = new AgentRuntimeRegistry();
    const state: FakeRuntimeState = { disposeCalls: 0 };
    const factory = async () => createFakeRuntime(state);

    await expect(
      registry.use({ key: "k", factory }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(state.disposeCalls).toBe(1);
    expect(registry.has("k")).toBe(false);
  });

  test("disposes the runtime if onCreate throws", async () => {
    const registry = new AgentRuntimeRegistry();
    const state: FakeRuntimeState = { disposeCalls: 0 };
    const factory = async () => createFakeRuntime(state);

    await expect(
      registry.use(
        {
          key: "k",
          factory,
          onCreate: () => {
            throw new Error("onCreate boom");
          }
        },
        async () => undefined
      )
    ).rejects.toThrow("onCreate boom");

    expect(state.disposeCalls).toBe(1);
    expect(registry.has("k")).toBe(false);
  });
});
