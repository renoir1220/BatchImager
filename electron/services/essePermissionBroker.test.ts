import { describe, expect, test } from "vitest";
import { EssePermissionBroker } from "./essePermissionBroker";
import { DEFAULT_ESSE_PERMISSION_POLICY } from "./essePermissionPolicy";
import type { EsseWorkspacePermissionRequest } from "./esseWorkspaceTools";

describe("EssePermissionBroker", () => {
  test("allows immediately when policy allows the risk", async () => {
    const sent: unknown[] = [];
    const broker = new EssePermissionBroker({ makeId: () => "permission-1" });

    await expect(broker.request({ send: (...args: unknown[]) => sent.push(args) }, createRequest("safe-write"), {
      policy: DEFAULT_ESSE_PERMISSION_POLICY,
      sessionAllowList: new Set()
    })).resolves.toEqual({ decision: "allow" });
    expect(sent).toEqual([]);
  });

  test("sends an IPC request and resolves allow-once responses", async () => {
    const sent: unknown[] = [];
    const broker = new EssePermissionBroker({ makeId: () => "permission-1" });
    const pending = broker.request({ send: (...args: unknown[]) => sent.push(args) }, createRequest("destructive"), {
      policy: DEFAULT_ESSE_PERMISSION_POLICY,
      sessionAllowList: new Set()
    });

    expect(sent).toEqual([["esse:permission-request", { payload: createRequest("destructive"), requestId: "permission-1" }]]);
    expect(broker.respond({ decision: "allow-once", requestId: "permission-1" })).toBe(true);
    await expect(pending).resolves.toEqual({ decision: "allow" });
  });

  test("honors allow-session for matching target keys", async () => {
    const sent: unknown[] = [];
    const allowList = new Set<string>();
    const broker = new EssePermissionBroker({ makeId: () => "permission-1" });
    const request = createRequest("destructive");
    const pending = broker.request({ send: (...args: unknown[]) => sent.push(args) }, request, {
      policy: DEFAULT_ESSE_PERMISSION_POLICY,
      sessionAllowList: allowList
    });

    expect(broker.respond({ decision: "allow-session", requestId: "permission-1" })).toBe(true);
    await expect(pending).resolves.toEqual({ decision: "allow" });
    await expect(broker.request({ send: (...args: unknown[]) => sent.push(args) }, request, {
      policy: DEFAULT_ESSE_PERMISSION_POLICY,
      sessionAllowList: allowList
    })).resolves.toEqual({ decision: "allow" });
    expect(sent).toHaveLength(1);
  });

  test("returns deny decisions and times out pending requests", async () => {
    let timeoutCallback: (() => void) | undefined;
    const broker = new EssePermissionBroker({
      makeId: () => "permission-1",
      setTimeoutFn: ((callback: () => void) => {
        timeoutCallback = callback;
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout
    });
    const pending = broker.request({ send: () => undefined }, createRequest("external-write"), {
      policy: DEFAULT_ESSE_PERMISSION_POLICY,
      sessionAllowList: new Set()
    });

    timeoutCallback?.();
    await expect(pending).resolves.toMatchObject({ decision: "deny", reason: "Permission request timed out" });
  });
});

function createRequest(risk: EsseWorkspacePermissionRequest["risk"]): EsseWorkspacePermissionRequest {
  return {
    label: "删除图片",
    params: { sessionId: "sess_1" },
    requiresPreflight: false,
    risk,
    targetKey: "delete_session:sess_1",
    toolName: "delete_session"
  };
}
