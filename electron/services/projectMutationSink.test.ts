import { describe, expect, test } from "vitest";
import { ProjectMutationSink, ProjectMutationSinkRegistry } from "./projectMutationSink";

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
    await expect(sink.apply((current) => ({ value: current.value + 1 }))).resolves.toEqual({ value: 1 });

    expect(broadcasts).toEqual([1]);
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
});
