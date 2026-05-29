import { describe, expect, test, vi } from "vitest";
import type { AgentPreflightPayload } from "../ipcTypes";
import { EssePreflightBroker } from "./essePreflightBroker";

describe("EssePreflightBroker", () => {
  test("sends a preflight request and resolves execute responses", async () => {
    const sent: unknown[] = [];
    const broker = new EssePreflightBroker({ makeId: () => "request-1" });
    const pending = broker.request({ send: (...args: unknown[]) => sent.push(args) }, createPayload());

    expect(sent).toEqual([
      ["agent:preflight-request", { payload: createPayload(), requestId: "request-1" }],
      ["esse:preflight-request", { payload: createPayload(), requestId: "request-1" }]
    ]);
    expect(broker.respond({ decision: "execute", requestId: "request-1" })).toBe(true);
    await expect(pending).resolves.toEqual({ decision: "execute" });
  });

  test("resolves cancel responses with detail", async () => {
    const broker = new EssePreflightBroker({ makeId: () => "request-1" });
    const pending = broker.request({ send: vi.fn() }, createPayload());

    expect(broker.respond({ decision: "cancel", detail: "用户取消", requestId: "request-1" })).toBe(true);
    await expect(pending).resolves.toEqual({ decision: "cancel", detail: "用户取消" });
  });

  test("resolves modify responses with modified commands", async () => {
    const broker = new EssePreflightBroker({ makeId: () => "request-1" });
    const pending = broker.request({ send: vi.fn() }, createPayload());
    const modifiedCommands = [{ ...createPayload().commands[0], prompt: "改成浅灰场景图" }];

    expect(broker.respond({ decision: "modify", modifiedCommands, requestId: "request-1" })).toBe(true);
    await expect(pending).resolves.toEqual({ decision: "modify", modifiedCommands });
  });

  test("cancels pending preflight on timeout", async () => {
    let timeoutCallback: (() => void) | undefined;
    const broker = new EssePreflightBroker({
      makeId: () => "request-1",
      setTimeoutFn: ((callback: () => void) => {
        timeoutCallback = callback;
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeoutFn: vi.fn() as typeof clearTimeout
    });
    const pending = broker.request({ send: vi.fn() }, createPayload());

    timeoutCallback?.();

    await expect(pending).resolves.toEqual({ decision: "cancel", detail: "Preflight timed out" });
    expect(broker.respond({ decision: "execute", requestId: "request-1" })).toBe(false);
  });

  test("rejects pending preflight on abort", async () => {
    const controller = new AbortController();
    const broker = new EssePreflightBroker({ makeId: () => "request-1" });
    const pending = broker.request({ send: vi.fn() }, createPayload(), { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toThrow("Operation aborted");
    expect(broker.respond({ decision: "execute", requestId: "request-1" })).toBe(false);
  });

  test("removes the abort listener when a pending preflight is rejected", async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const broker = new EssePreflightBroker({ makeId: () => "request-1" });
    const pending = broker.request({ send: vi.fn() }, createPayload(), { signal: controller.signal });

    expect(broker.reject("request-1", new Error("manual reject"))).toBe(true);

    await expect(pending).rejects.toThrow("manual reject");
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

function createPayload(): AgentPreflightPayload {
  return {
    commands: [
      {
        displayLabel: "img-1",
        mode: "edit",
        prompt: "白底商品图",
        target: { sessionId: "sess_1", type: "existing" }
      }
    ],
    estimatedApiCalls: 1,
    tool: "generate_image"
  };
}
