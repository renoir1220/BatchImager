import { describe, expect, test } from "vitest";
import { EsseBatchTaskRegistry } from "./esseBatchTaskRegistry";

describe("EsseBatchTaskRegistry", () => {
  test("cancels one active item without aborting sibling items", () => {
    const registry = new EsseBatchTaskRegistry();
    const first = new AbortController();
    const second = new AbortController();

    expect(registry.register({
      batchTaskId: "batch_1",
      items: [
        { controller: first, sessionId: "sess_1" },
        { controller: second, sessionId: "sess_2" }
      ],
      projectDirectory: "/project"
    })).toEqual({ itemCount: 2, ok: true });

    expect(registry.cancelItem("batch_1", "sess_1")).toEqual({
      canceled: true,
      remainingItemCount: 1
    });
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(registry.getSnapshot("batch_1")).toEqual({
      activeSessionIds: ["sess_2"],
      batchTaskId: "batch_1",
      projectDirectory: "/project",
      retryCounts: {}
    });
  });

  test("cancels all remaining active items and removes the completed task", () => {
    const registry = new EsseBatchTaskRegistry();
    const first = new AbortController();
    const second = new AbortController();

    registry.register({
      batchTaskId: "batch_1",
      items: [
        { controller: first, sessionId: "sess_1" },
        { controller: second, sessionId: "sess_2" }
      ],
      projectDirectory: "/project"
    });
    registry.notifyItemComplete("batch_1", "sess_1");

    expect(registry.cancelAll("batch_1")).toEqual({
      canceledCount: 1
    });
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(true);
    expect(registry.has("batch_1")).toBe(false);
  });

  test("removes a task after the last active item completes", () => {
    const registry = new EsseBatchTaskRegistry();

    registry.register({
      batchTaskId: "batch_1",
      items: [
        { controller: new AbortController(), sessionId: "sess_1" },
        { controller: new AbortController(), sessionId: "sess_2" }
      ],
      projectDirectory: "/project"
    });

    registry.notifyItemComplete("batch_1", "sess_1");
    expect(registry.has("batch_1")).toBe(true);

    registry.notifyItemComplete("batch_1", "sess_2");
    expect(registry.has("batch_1")).toBe(false);
  });

  test("tracks retry counts up to a fixed maximum after active items have completed", () => {
    const registry = new EsseBatchTaskRegistry();

    registry.register({
      batchTaskId: "batch_1",
      items: [{ controller: new AbortController(), sessionId: "sess_1" }],
      projectDirectory: "/project"
    });
    registry.notifyItemComplete("batch_1", "sess_1");
    expect(registry.has("batch_1")).toBe(false);

    expect(registry.recordRetry("batch_1", "sess_1")).toEqual({ ok: true, retryCount: 1 });
    expect(registry.recordRetry("batch_1", "sess_1")).toEqual({ ok: true, retryCount: 2 });
    expect(registry.recordRetry("batch_1", "sess_1")).toEqual({ ok: true, retryCount: 3 });
    expect(registry.recordRetry("batch_1", "sess_1")).toEqual({
      ok: false,
      reason: "retry limit reached",
      retryCount: 3
    });
  });

  test("registers a retry item under a completed task and prevents duplicate active retries", () => {
    const registry = new EsseBatchTaskRegistry();
    const firstRetry = new AbortController();
    const duplicateRetry = new AbortController();

    expect(registry.recordRetry("batch_1", "sess_1")).toEqual({ ok: true, retryCount: 1 });
    expect(registry.registerItem("batch_1", { controller: firstRetry, sessionId: "sess_1" }, "/project")).toEqual({
      itemCount: 1,
      ok: true
    });
    expect(registry.registerItem("batch_1", { controller: duplicateRetry, sessionId: "sess_1" }, "/project")).toEqual({
      ok: false,
      reason: "batch item already active"
    });
    expect(registry.recordRetry("batch_1", "sess_1")).toEqual({
      ok: false,
      reason: "batch item already active",
      retryCount: 0
    });
    expect(registry.getSnapshot("batch_1")).toEqual({
      activeSessionIds: ["sess_1"],
      batchTaskId: "batch_1",
      projectDirectory: "/project",
      retryCounts: { sess_1: 1 }
    });
  });

  test("keeps unknown cancel operations as no-ops while allowing retry bookkeeping", () => {
    const registry = new EsseBatchTaskRegistry();

    expect(registry.cancelItem("missing", "sess_1")).toEqual({
      canceled: false,
      remainingItemCount: 0
    });
    expect(registry.cancelAll("missing")).toEqual({ canceledCount: 0 });
    expect(registry.recordRetry("missing", "sess_1")).toEqual({ ok: true, retryCount: 1 });
  });
});
