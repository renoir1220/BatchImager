import { afterEach, describe, expect, test } from "vitest";
import { ProjectMutationSink, ProjectMutationSinkRegistry } from "./projectMutationSink";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("ProjectMutationSink", () => {
  test("serializes mutations and broadcasts successful states", async () => {
    let state = { value: 0 };
    const applyOrder: number[] = [];
    const broadcasts: number[] = [];
    const sink = new ProjectMutationSink<typeof state>({
      applyTransaction: async (mutator) => {
        const before = state.value;
        applyOrder.push(before);
        await Promise.resolve();
        state = mutator(state);
        return state;
      },
      broadcast: (nextState) => {
        broadcasts.push(nextState.value);
      }
    });

    const first = sink.apply((current) => ({ value: current.value + 1 }));
    const second = sink.apply((current) => ({ value: current.value + 1 }));

    await expect(Promise.all([first, second])).resolves.toEqual([{ value: 1 }, { value: 2 }]);
    expect(applyOrder).toEqual([0, 1]);
    expect(broadcasts).toEqual([1, 2]);
  });

  test("continues the queue after a failed mutation and does not broadcast failures", async () => {
    let state = { value: 0 };
    const broadcasts: number[] = [];
    const sink = new ProjectMutationSink<typeof state>({
      applyTransaction: async (mutator) => {
        state = mutator(state);
        return state;
      },
      broadcast: (nextState) => {
        broadcasts.push(nextState.value);
      }
    });

    await expect(
      sink.apply(() => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(sink.getRevision()).toBe(0);
    await expect(sink.apply((current) => ({ value: current.value + 1 }))).resolves.toEqual({ value: 1 });

    expect(broadcasts).toEqual([1]);
    expect(sink.getRevision()).toBe(1);
  });

  test("increments revisions for committed mutations unless explicitly skipped", async () => {
    let state = { value: 0 };
    const sink = new ProjectMutationSink<typeof state>({
      applyTransaction: async (mutator) => {
        state = mutator(state);
        return state;
      }
    });

    expect(sink.getRevision()).toBe(0);
    await sink.apply((current) => ({ value: current.value + 1 }));
    expect(sink.getRevision()).toBe(1);
    await sink.apply((current) => ({ value: current.value + 1 }), { countRevision: false });
    expect(sink.getRevision()).toBe(1);
    expect(state).toEqual({ value: 2 });
  });

  test("commits mutations and reports telemetry when broadcast fails", async () => {
    let state = { value: 0 };
    const broadcastErrors: Array<{ error: unknown; state: { value: number } }> = [];
    const sink = new ProjectMutationSink<typeof state>({
      applyTransaction: async (mutator) => {
        state = mutator(state);
        return state;
      },
      broadcast: () => {
        throw new Error("window gone");
      },
      onBroadcastError: (error, nextState) => {
        broadcastErrors.push({ error, state: nextState });
      }
    });

    await expect(sink.apply((current) => ({ value: current.value + 1 }))).resolves.toEqual({ value: 1 });

    expect(state).toEqual({ value: 1 });
    expect(broadcastErrors).toHaveLength(1);
    expect(broadcastErrors[0]?.error).toBeInstanceOf(Error);
    expect(broadcastErrors[0]?.state).toEqual({ value: 1 });
  });
});

describe("ProjectMutationSinkRegistry", () => {
  test("reuses one sink per key and keeps different project keys isolated", () => {
    const registry = new ProjectMutationSinkRegistry<{ value: number }>();
    const options = {
      applyTransaction: async (mutator: (current: { value: number }) => { value: number }) => mutator({ value: 0 })
    };

    const first = registry.getOrCreate("project-a", options);
    const again = registry.getOrCreate("project-a", options);
    const other = registry.getOrCreate("project-b", options);

    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  test("throws in development when the same key is reused with different options", () => {
    process.env.NODE_ENV = "development";
    const registry = new ProjectMutationSinkRegistry<{ value: number }>();
    const firstOptions = {
      applyTransaction: async (mutator: (current: { value: number }) => { value: number }) => mutator({ value: 0 })
    };
    const secondOptions = {
      applyTransaction: async (mutator: (current: { value: number }) => { value: number }) => mutator({ value: 1 })
    };

    registry.getOrCreate("project-a", firstOptions);

    expect(() => registry.getOrCreate("project-a", secondOptions)).toThrow(
      "ProjectMutationSinkRegistry options changed for key: project-a"
    );
  });

  test("keeps production getOrCreate compatible when options differ", () => {
    process.env.NODE_ENV = "production";
    const registry = new ProjectMutationSinkRegistry<{ value: number }>();
    const firstOptions = {
      applyTransaction: async (mutator: (current: { value: number }) => { value: number }) => mutator({ value: 0 })
    };
    const secondOptions = {
      applyTransaction: async (mutator: (current: { value: number }) => { value: number }) => mutator({ value: 1 })
    };

    const first = registry.getOrCreate("project-a", firstOptions);
    const again = registry.getOrCreate("project-a", secondOptions);

    expect(again).toBe(first);
  });

  test("serializes mutations across callers that resolve the same key", async () => {
    const registry = new ProjectMutationSinkRegistry<{ value: number }>();
    let state = { value: 0 };
    const applyOrder: number[] = [];
    const options = {
      applyTransaction: async (mutator: (current: { value: number }) => { value: number }) => {
        applyOrder.push(state.value);
        await Promise.resolve();
        state = mutator(state);
        return state;
      }
    };
    const firstCaller = registry.getOrCreate("project-a", options);
    const secondCaller = registry.getOrCreate("project-a", options);

    await expect(
      Promise.all([
        firstCaller.apply((current) => ({ value: current.value + 1 })),
        secondCaller.apply((current) => ({ value: current.value + 1 }))
      ])
    ).resolves.toEqual([{ value: 1 }, { value: 2 }]);

    expect(applyOrder).toEqual([0, 1]);
    expect(state).toEqual({ value: 2 });
  });
});
