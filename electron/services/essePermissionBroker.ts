import type { WebContents } from "electron";
import type { EssePermissionRequest, EssePermissionResponse } from "../ipcTypes";
import type { EsseWorkspacePermissionDecision, EsseWorkspacePermissionRequest } from "./esseWorkspaceTools";
import type { EssePermissionPolicy } from "./essePermissionPolicy";

interface PendingPermission {
  allowKey: string;
  cleanup?: () => void;
  reject: (error: Error) => void;
  resolve: (decision: EsseWorkspacePermissionDecision) => void;
  sessionAllowList: Set<string>;
  timeout: NodeJS.Timeout;
}

interface EssePermissionBrokerOptions {
  clearTimeoutFn?: typeof clearTimeout;
  makeId?: () => string;
  setTimeoutFn?: typeof setTimeout;
  timeoutMs?: number;
}

const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

export class EssePermissionBroker {
  private readonly pending = new Map<string, PendingPermission>();
  private sequence = 0;

  constructor(private readonly options: EssePermissionBrokerOptions = {}) {}

  request(
    webContents: Pick<WebContents, "send">,
    payload: EsseWorkspacePermissionRequest,
    options: { policy: EssePermissionPolicy; sessionAllowList: Set<string>; signal?: AbortSignal }
  ): Promise<EsseWorkspacePermissionDecision> {
    if (payload.risk === "read" || options.policy[payload.risk] === "allow") {
      return Promise.resolve({ decision: "allow" });
    }

    const allowKey = payload.targetKey ?? `${payload.toolName}:global`;
    if (options.sessionAllowList.has(allowKey)) {
      return Promise.resolve({ decision: "allow" });
    }

    const requestId = this.options.makeId?.() ?? this.createRequestId();
    const timeout = (this.options.setTimeoutFn ?? setTimeout)(() => {
      this.resolve(requestId, { decision: "deny", reason: "Permission request timed out" });
    }, this.options.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS);
    const request: EssePermissionRequest = { payload, requestId };

    return new Promise((resolve, reject) => {
      const abort = () => {
        this.reject(requestId, new Error("Operation aborted"));
      };

      this.pending.set(requestId, {
        allowKey,
        cleanup: () => {
          options.signal?.removeEventListener("abort", abort);
        },
        reject,
        resolve,
        sessionAllowList: options.sessionAllowList,
        timeout
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      webContents.send("esse:permission-request", request);
    });
  }

  respond(response: EssePermissionResponse): boolean {
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return false;
    }

    if (response.decision === "allow-session") {
      pending.sessionAllowList.add(pending.allowKey);
      return this.resolve(response.requestId, { decision: "allow" });
    }

    if (response.decision === "allow-once") {
      return this.resolve(response.requestId, { decision: "allow" });
    }

    return this.resolve(response.requestId, {
      decision: "deny",
      reason: response.reason || "用户拒绝了 Esse 的操作请求。",
      suggestedNext: "不要重试同一个工具调用，先询问用户要如何调整。"
    });
  }

  reject(requestId: string, error: Error): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return false;
    }

    this.pending.delete(requestId);
    (this.options.clearTimeoutFn ?? clearTimeout)(pending.timeout);
    pending.cleanup?.();
    pending.reject(error);
    return true;
  }

  private resolve(requestId: string, decision: EsseWorkspacePermissionDecision): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return false;
    }

    this.pending.delete(requestId);
    (this.options.clearTimeoutFn ?? clearTimeout)(pending.timeout);
    pending.cleanup?.();
    pending.resolve(decision);
    return true;
  }

  private createRequestId(): string {
    this.sequence += 1;
    return `esse-permission-${Date.now()}-${this.sequence}`;
  }
}
