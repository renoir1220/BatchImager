export interface EsseBatchTaskItem {
  controller: AbortController;
  retryCount?: number;
  sessionId: string;
}

export interface RegisterEsseBatchTaskRequest {
  batchTaskId: string;
  items: EsseBatchTaskItem[];
  projectDirectory: string;
}

export interface EsseBatchTaskSnapshot {
  activeSessionIds: string[];
  batchTaskId: string;
  projectDirectory: string;
  retryCounts: Record<string, number>;
}

interface RegisteredBatchTask {
  batchTaskId: string;
  controllersBySessionId: Map<string, AbortController>;
  projectDirectory: string;
}

export class EsseBatchTaskRegistry {
  private readonly tasksById = new Map<string, RegisteredBatchTask>();
  private readonly retryCountsByBatchId = new Map<string, Map<string, number>>();

  register(request: RegisterEsseBatchTaskRequest): { itemCount: number; ok: true } | { ok: false; reason: string } {
    if (this.tasksById.has(request.batchTaskId)) {
      return { ok: false, reason: "batch task already registered" };
    }

    const controllersBySessionId = new Map<string, AbortController>();
    const retryCountsBySessionId = this.getRetryCountsForBatch(request.batchTaskId);
    for (const item of request.items) {
      if (controllersBySessionId.has(item.sessionId)) {
        return { ok: false, reason: "duplicate session id" };
      }
      controllersBySessionId.set(item.sessionId, item.controller);
      if (item.retryCount !== undefined) {
        retryCountsBySessionId.set(item.sessionId, item.retryCount);
      }
    }

    this.tasksById.set(request.batchTaskId, {
      batchTaskId: request.batchTaskId,
      controllersBySessionId,
      projectDirectory: request.projectDirectory
    });

    if (controllersBySessionId.size === 0) {
      this.tasksById.delete(request.batchTaskId);
    }

    return { itemCount: controllersBySessionId.size, ok: true };
  }

  registerItem(
    batchTaskId: string,
    item: EsseBatchTaskItem,
    projectDirectory: string
  ): { itemCount: number; ok: true } | { ok: false; reason: string } {
    let task = this.tasksById.get(batchTaskId);
    if (!task) {
      task = {
        batchTaskId,
        controllersBySessionId: new Map(),
        projectDirectory
      };
      this.tasksById.set(batchTaskId, task);
    }

    if (task.controllersBySessionId.has(item.sessionId)) {
      return { ok: false, reason: "batch item already active" };
    }

    task.controllersBySessionId.set(item.sessionId, item.controller);
    if (item.retryCount !== undefined) {
      this.getRetryCountsForBatch(batchTaskId).set(item.sessionId, item.retryCount);
    }
    return { itemCount: task.controllersBySessionId.size, ok: true };
  }

  has(batchTaskId: string): boolean {
    return this.tasksById.has(batchTaskId);
  }

  getSnapshot(batchTaskId: string): EsseBatchTaskSnapshot | undefined {
    const task = this.tasksById.get(batchTaskId);
    if (!task) {
      return undefined;
    }

    return {
      activeSessionIds: [...task.controllersBySessionId.keys()],
      batchTaskId: task.batchTaskId,
      projectDirectory: task.projectDirectory,
      retryCounts: Object.fromEntries(this.getRetryCountsForBatch(batchTaskId))
    };
  }

  cancelItem(batchTaskId: string, sessionId: string): { canceled: boolean; remainingItemCount: number } {
    const task = this.tasksById.get(batchTaskId);
    if (!task) {
      return { canceled: false, remainingItemCount: 0 };
    }

    const controller = task.controllersBySessionId.get(sessionId);
    if (!controller) {
      return { canceled: false, remainingItemCount: task.controllersBySessionId.size };
    }

    controller.abort();
    task.controllersBySessionId.delete(sessionId);
    this.deleteTaskIfDrained(task);
    return {
      canceled: true,
      remainingItemCount: task.controllersBySessionId.size
    };
  }

  cancelAll(batchTaskId: string): { canceledCount: number } {
    const task = this.tasksById.get(batchTaskId);
    if (!task) {
      return { canceledCount: 0 };
    }

    let canceledCount = 0;
    for (const controller of task.controllersBySessionId.values()) {
      controller.abort();
      canceledCount += 1;
    }
    this.tasksById.delete(batchTaskId);
    return { canceledCount };
  }

  notifyItemComplete(batchTaskId: string, sessionId: string): void {
    const task = this.tasksById.get(batchTaskId);
    if (!task) {
      return;
    }

    task.controllersBySessionId.delete(sessionId);
    this.deleteTaskIfDrained(task);
  }

  recordRetry(
    batchTaskId: string,
    sessionId: string,
    maxRetries = 3
  ): { ok: true; retryCount: number } | { ok: false; reason: string; retryCount: number } {
    const task = this.tasksById.get(batchTaskId);
    if (task?.controllersBySessionId.has(sessionId)) {
      return { ok: false, reason: "batch item already active", retryCount: 0 };
    }

    const retryCounts = this.getRetryCountsForBatch(batchTaskId);
    const retryCount = retryCounts.get(sessionId) ?? 0;
    if (retryCount >= maxRetries) {
      return { ok: false, reason: "retry limit reached", retryCount };
    }

    const nextRetryCount = retryCount + 1;
    retryCounts.set(sessionId, nextRetryCount);
    return { ok: true, retryCount: nextRetryCount };
  }

  private getRetryCountsForBatch(batchTaskId: string): Map<string, number> {
    let retryCounts = this.retryCountsByBatchId.get(batchTaskId);
    if (!retryCounts) {
      retryCounts = new Map();
      this.retryCountsByBatchId.set(batchTaskId, retryCounts);
    }
    return retryCounts;
  }

  private deleteTaskIfDrained(task: RegisteredBatchTask): void {
    if (task.controllersBySessionId.size === 0) {
      this.tasksById.delete(task.batchTaskId);
    }
  }
}
