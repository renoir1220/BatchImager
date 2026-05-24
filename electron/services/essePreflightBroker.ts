import type { WebContents } from "electron";
import type { EssePreflightPayload, EssePreflightRequest, EssePreflightResponse } from "../ipcTypes";
import type { EssePreflightDecision } from "./esseWorkspaceTools";

interface PendingPreflight {
  cleanup?: () => void;
  reject: (error: Error) => void;
  resolve: (decision: EssePreflightDecision) => void;
  timeout: NodeJS.Timeout;
}

interface EssePreflightBrokerOptions {
  makeId?: () => string;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  timeoutMs?: number;
}

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 10 * 60 * 1000;

export class EssePreflightBroker {
  private readonly pending = new Map<string, PendingPreflight>();
  private sequence = 0;

  constructor(private readonly options: EssePreflightBrokerOptions = {}) {}

  request(
    webContents: Pick<WebContents, "send">,
    payload: EssePreflightPayload,
    options: { signal?: AbortSignal } = {}
  ): Promise<EssePreflightDecision> {
    const requestId = this.options.makeId?.() ?? this.createRequestId();
    const timeout = (this.options.setTimeoutFn ?? setTimeout)(() => {
      this.resolve(requestId, { decision: "cancel", detail: "Preflight timed out" });
    }, this.options.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS);

    const request: EssePreflightRequest = { payload, requestId };

    return new Promise((resolve, reject) => {
      const abort = () => {
        this.reject(requestId, new Error("Operation aborted"));
      };

      this.pending.set(requestId, {
        cleanup: () => {
          options.signal?.removeEventListener("abort", abort);
        },
        reject,
        resolve,
        timeout
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      webContents.send("esse:preflight-request", request);
    });
  }

  respond(response: EssePreflightResponse): boolean {
    const decision: EssePreflightDecision =
      response.decision === "execute"
        ? { decision: "execute" }
        : response.decision === "modify"
          ? { decision: "modify", modifiedCommands: response.modifiedCommands ?? [] }
          : { decision: "cancel", ...(response.detail ? { detail: response.detail } : {}) };
    return this.resolve(response.requestId, decision);
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

  private resolve(requestId: string, decision: EssePreflightDecision): boolean {
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
    return `esse-preflight-${Date.now()}-${this.sequence}`;
  }
}
