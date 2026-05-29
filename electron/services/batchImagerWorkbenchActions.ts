import type { PersistedImageSession, PersistedUndoEntry, ProjectSnapshot, SerializableUndoDescriptor } from "../ipcTypes";

export type BatchImagerWorkbenchState = ProjectSnapshot;

export type BatchImagerWorkbenchActionResult =
  | { ok: true; affectedSessionIds: string[]; summary: string }
  | { ok: false; detail?: string; reason: string; suggestedNext?: string };

export interface BatchImagerWorkbenchMutation {
  result: BatchImagerWorkbenchActionResult;
  state: BatchImagerWorkbenchState;
}

export function restoreWorkbenchSessionRecord(
  state: BatchImagerWorkbenchState,
  params: { recordIndex: number; sessionId: string }
): BatchImagerWorkbenchMutation {
  const resolved = resolveRecord(state, params.sessionId, params.recordIndex);
  if (!("filePath" in resolved)) {
    return { state, result: resolved.result };
  }

  return ok(
    updateSession(state, params.sessionId, (session) => ({
      ...session,
      generatedFilePath: resolved.filePath,
      showOriginalInList: false
    })),
    [params.sessionId],
    `已切换到记录 ${params.recordIndex}。`
  );
}

export function deleteWorkbenchSessionRecord(
  state: BatchImagerWorkbenchState,
  params: { recordIndex: number; sessionId: string }
): BatchImagerWorkbenchMutation {
  const resolved = resolveRecord(state, params.sessionId, params.recordIndex);
  if (!("filePath" in resolved)) {
    return { state, result: resolved.result };
  }

  const remaining = resolved.session.generatedFilePaths?.filter((_filePath, index) => index !== params.recordIndex - 1) ?? [];
  if (resolved.session.originatedFromGeneration && remaining.length === 0) {
    return deleteWorkbenchSession(state, { sessionId: params.sessionId });
  }

  const fallback = chooseFallback(resolved.session, params.recordIndex, remaining);
  return ok(
    updateSession(state, params.sessionId, (session) => ({
      ...session,
      chatMessages: session.chatMessages.map((message) =>
        message.generatedFilePath === resolved.filePath ? { ...message, generatedFilePath: undefined } : message
      ),
      generatedFilePath: fallback,
      generatedFilePaths: remaining.length ? remaining : undefined,
      showOriginalInList: !fallback
    })),
    [params.sessionId],
    `已删除记录 ${params.recordIndex}。`
  );
}

export function restoreOriginalWorkbenchImage(
  state: BatchImagerWorkbenchState,
  params: { sessionId: string }
): BatchImagerWorkbenchMutation {
  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  if (session.originatedFromGeneration) {
    const primaryGeneratedPath = session.generatedFilePaths?.[0] ?? session.generatedFilePath ?? session.filePath;
    return ok(
      updateSession(state, params.sessionId, (current) => ({
        ...current,
        generatedFilePath: primaryGeneratedPath,
        showOriginalInList: false
      })),
      [params.sessionId],
      "已切回第一张生成图。"
    );
  }

  return ok(
    updateSession(state, params.sessionId, (current) => ({
      ...current,
      generatedFilePath: undefined,
      showOriginalInList: false
    })),
    [params.sessionId],
    "已恢复为原图。"
  );
}

export function renameWorkbenchSession(
  state: BatchImagerWorkbenchState,
  params: { fileName: string; sessionId: string }
): BatchImagerWorkbenchMutation {
  if (!params.fileName) {
    return fail(state, "fileName is required", undefined, "provide a non-empty fileName.");
  }

  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  return ok(
    updateSession(state, params.sessionId, (current) => ({
      ...current,
      fileName: params.fileName
    })),
    [params.sessionId],
    `已重命名为 ${params.fileName}。`
  );
}

export function reorderWorkbenchSessions(
  state: BatchImagerWorkbenchState,
  params: { sessionIds: string[] }
): BatchImagerWorkbenchMutation {
  const currentIds = state.sessions.map((session) => session.id);
  const requestedIds = params.sessionIds;
  if (requestedIds.length !== currentIds.length || new Set(requestedIds).size !== requestedIds.length) {
    return fail(state, "sessionIds must be a full permutation", undefined, "pass every current session id exactly once.");
  }

  const byId = new Map(state.sessions.map((session) => [session.id, session]));
  const nextSessions = requestedIds.map((id) => byId.get(id));
  if (nextSessions.some((session) => !session)) {
    return fail(state, "sessionIds must be a full permutation", undefined, "call list_sessions and retry with current ids.");
  }

  return ok(
    {
      ...state,
      sessions: nextSessions as PersistedImageSession[]
    },
    requestedIds,
    "已调整图片顺序。"
  );
}

export function setWorkbenchSessionPrompt(
  state: BatchImagerWorkbenchState,
  params: { prompt: string; sessionId: string }
): BatchImagerWorkbenchMutation {
  if (!params.prompt) {
    return fail(state, "prompt is required", undefined, "provide a non-empty prompt.");
  }

  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  return ok(
    updateSession(state, params.sessionId, (current) => ({
      ...current,
      lastPrompt: params.prompt
    })),
    [params.sessionId],
    "已更新这张图的默认提示词。"
  );
}

export function deleteWorkbenchSession(
  state: BatchImagerWorkbenchState,
  params: { sessionId: string }
): BatchImagerWorkbenchMutation {
  const removedIndex = state.sessions.findIndex((session) => session.id === params.sessionId);
  if (removedIndex < 0) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const sessions = state.sessions.filter((session) => session.id !== params.sessionId);
  return ok(
    {
      ...state,
      project: { ...state.project, imageCount: sessions.length },
      selectedSessionId:
        state.selectedSessionId === params.sessionId
          ? sessions[Math.min(removedIndex, sessions.length - 1)]?.id ?? null
          : state.selectedSessionId,
      sessions
    },
    [params.sessionId],
    "已删除图片。"
  );
}

export function mergeWorkbenchSessions(
  state: BatchImagerWorkbenchState,
  params: { sourceSessionIds: string[]; targetSessionId: string }
): BatchImagerWorkbenchMutation {
  const target = state.sessions.find((session) => session.id === params.targetSessionId);
  if (!target) {
    return fail(state, "target session not found", `no session with id ${params.targetSessionId}`, "call list_sessions to list current ids.");
  }

  const sourceIds = [...new Set(params.sourceSessionIds.filter((id) => id !== params.targetSessionId))];
  const sources = sourceIds.map((id) => state.sessions.find((session) => session.id === id));
  const missingId = sourceIds.find((id, index) => !sources[index]);
  if (sourceIds.length === 0) {
    return fail(state, "sourceSessionIds are required", undefined, "provide at least one source session id different from targetSessionId.");
  }
  if (missingId) {
    return fail(state, "source session not found", `no session with id ${missingId}`, "call list_sessions to list current ids.");
  }

  const sourceSessions = sources as PersistedImageSession[];
  const mergedRecords = uniquePaths([
    ...(target.generatedFilePaths ?? []),
    ...sourceSessions.flatMap((session) => session.generatedFilePaths ?? []),
    ...sourceSessions.flatMap((session) => (session.generatedFilePath ? [session.generatedFilePath] : []))
  ]);

  return ok(
    {
      ...state,
      project: { ...state.project, imageCount: state.sessions.length - sourceIds.length },
      selectedSessionId: sourceIds.includes(state.selectedSessionId ?? "") ? params.targetSessionId : state.selectedSessionId,
      sessions: state.sessions
        .filter((session) => !sourceIds.includes(session.id))
        .map((session) =>
          session.id === params.targetSessionId
            ? {
                ...session,
                chatMessages: [...session.chatMessages, ...sourceSessions.flatMap((sourceSession) => sourceSession.chatMessages)],
                generatedFilePath: session.generatedFilePath ?? mergedRecords.at(-1),
                generatedFilePaths: mergedRecords.length ? mergedRecords : session.generatedFilePaths
              }
            : session
        )
    },
    [params.targetSessionId, ...sourceIds],
    `已合并 ${sourceIds.length} 张图片。`
  );
}

export function splitWorkbenchSession(
  state: BatchImagerWorkbenchState,
  params: { fileName?: string; recordIndexes: number[]; sessionId: string }
): BatchImagerWorkbenchMutation {
  const sourceIndex = state.sessions.findIndex((session) => session.id === params.sessionId);
  const source = state.sessions[sourceIndex];
  if (!source) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const records = source.generatedFilePaths ?? [];
  const recordIndexes = [...new Set(params.recordIndexes)];
  if (!recordIndexes.length) {
    return fail(state, "recordIndexes are required", undefined, "provide at least one 1-based record index.");
  }

  const invalidIndex = recordIndexes.find((recordIndex) => !Number.isInteger(recordIndex) || recordIndex < 1 || recordIndex > records.length);
  if (invalidIndex !== undefined) {
    return fail(
      state,
      "recordIndex out of range",
      `${params.sessionId} has ${records.length} records, requested ${invalidIndex}.`,
      "call get_session_records to verify."
    );
  }

  if (recordIndexes.length >= records.length) {
    return fail(state, "cannot split all records", undefined, "use delete_session or duplicate_session instead of splitting every record.");
  }

  const movedIndexes = new Set(recordIndexes.map((recordIndex) => recordIndex - 1));
  const movedRecords = recordIndexes.map((recordIndex) => records[recordIndex - 1]);
  const remainingRecords = records.filter((_record, index) => !movedIndexes.has(index));
  const currentRecordIndex = source.generatedFilePath ? records.indexOf(source.generatedFilePath) + 1 : 0;
  const fallback =
    currentRecordIndex > 0 && movedIndexes.has(currentRecordIndex - 1)
      ? chooseFallback(source, currentRecordIndex, remainingRecords)
      : source.generatedFilePath && remainingRecords.includes(source.generatedFilePath)
        ? source.generatedFilePath
        : remainingRecords.at(-1);
  const newSessionId = createUniqueWorkbenchSessionId(state);
  const newFileName = params.fileName || basenameFromPath(movedRecords[0]);
  const newSession: PersistedImageSession = {
    chatMessages: [],
    chatStatus: "idle",
    fileName: newFileName,
    filePath: movedRecords[0],
    generatedFilePath: movedRecords[0],
    generatedFilePaths: movedRecords,
    id: newSessionId,
    originatedFromGeneration: true,
    showOriginalInList: false,
    status: "completed"
  };

  return ok(
    {
      ...state,
      project: { ...state.project, imageCount: state.sessions.length + 1 },
      selectedSessionId: newSessionId,
      sessions: state.sessions.flatMap((session, index) => {
        if (session.id !== params.sessionId) {
          return [session];
        }

        const updatedSource: PersistedImageSession = {
          ...session,
          chatMessages: session.chatMessages.map((message) =>
            message.generatedFilePath && movedRecords.includes(message.generatedFilePath) ? { ...message, generatedFilePath: undefined } : message
          ),
          generatedFilePath: fallback,
          generatedFilePaths: remainingRecords,
          showOriginalInList: !fallback
        };
        return index === sourceIndex ? [updatedSource, newSession] : [updatedSource];
      })
    },
    [params.sessionId, newSessionId],
    `已拆分 ${movedRecords.length} 条记录为 ${newFileName}。`
  );
}

export function duplicateWorkbenchSession(
  state: BatchImagerWorkbenchState,
  params: { fileName?: string; sessionId: string }
): BatchImagerWorkbenchMutation {
  const sourceIndex = state.sessions.findIndex((session) => session.id === params.sessionId);
  const source = state.sessions[sourceIndex];
  if (!source) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const newSessionId = createUniqueWorkbenchSessionId(state);
  const duplicate: PersistedImageSession = {
    chatMessages: [],
    chatStatus: "idle",
    fileName: params.fileName || `副本-${source.fileName}`,
    filePath: source.filePath,
    id: newSessionId,
    status: "completed",
    ...(source.generatedFilePath ? { generatedFilePath: source.generatedFilePath } : {}),
    ...(source.generatedFilePaths?.length ? { generatedFilePaths: [...source.generatedFilePaths] } : {}),
    ...(source.generationMode ? { generationMode: source.generationMode } : {}),
    ...(source.lastPrompt ? { lastPrompt: source.lastPrompt } : {}),
    ...(source.originatedFromGeneration ? { originatedFromGeneration: true } : {}),
    showOriginalInList: source.showOriginalInList
  };

  return ok(
    {
      ...state,
      project: { ...state.project, imageCount: state.sessions.length + 1 },
      selectedSessionId: newSessionId,
      sessions: state.sessions.flatMap((session, index) => (index === sourceIndex ? [session, duplicate] : [session]))
    },
    [params.sessionId, newSessionId],
    `已复制 ${source.fileName}。新副本是 img-${sourceIndex + 2}，sessionId=${newSessionId}。`
  );
}

export function undoLastWorkbenchActions(
  state: BatchImagerWorkbenchState,
  count: number,
  currentSinkRevision: number | undefined
): BatchImagerWorkbenchMutation {
  const entries = [...(state.esseUndoLog ?? [])].reverse().filter((entry) => !entry.undone).slice(0, count);
  if (!entries.length) {
    return fail(state, "nothing to undo", undefined, "There are no reversible workspace actions to undo.");
  }

  let nextState = state;
  const undoneSummaries: string[] = [];
  const affectedSessionIds = new Set<string>();

  for (const entry of entries) {
    nextState = applyUndoDescriptor(nextState, entry.inverseDescriptor);
    const undoneIds = new Set([entry.id]);
    nextState = {
      ...nextState,
      esseUndoLog: (nextState.esseUndoLog ?? []).map((current) => (undoneIds.has(current.id) ? { ...current, undone: true } : current))
    };
    undoneSummaries.push(entry.summary);
    for (const sessionId of entry.affectedSessionIds) {
      affectedSessionIds.add(sessionId);
    }
  }

  const revisionWarning = formatUndoRevisionWarning(entries, currentSinkRevision);
  return ok(
    nextState,
    [...affectedSessionIds],
    `${revisionWarning ?? ""}已撤销 ${entries.length} 个操作：${undoneSummaries.join("；")}`
  );
}

export function appendWorkbenchUndoEntry(
  state: BatchImagerWorkbenchState,
  entry: PersistedUndoEntry
): BatchImagerWorkbenchState {
  return {
    ...state,
    esseUndoLog: [...(state.esseUndoLog ?? []), entry].slice(-50)
  };
}

export function createWorkbenchUndoEntry(params: {
  affectedSessionIds: string[];
  beforeState: BatchImagerWorkbenchState;
  sinkRevisionAfter?: number;
  summary: string;
  toolName: string;
}): PersistedUndoEntry {
  return {
    affectedSessionIds: params.affectedSessionIds,
    createdAt: new Date().toISOString(),
    id: `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    inverseDescriptor: createRestoreWorkspaceDescriptor(params.beforeState),
    ...(params.sinkRevisionAfter !== undefined ? { sinkRevisionAfter: params.sinkRevisionAfter } : {}),
    summary: params.summary,
    toolName: params.toolName
  };
}

function createRestoreWorkspaceDescriptor(state: BatchImagerWorkbenchState): SerializableUndoDescriptor {
  return {
    kind: "restore-workspace",
    projectImageCount: state.project.imageCount,
    ...(state.referenceImages?.length ? { referenceImages: state.referenceImages.map((referenceImage) => ({ ...referenceImage })) } : {}),
    selectedSessionId: state.selectedSessionId ?? null,
    sessions: state.sessions.map(cloneSession)
  };
}

function applyUndoDescriptor(
  state: BatchImagerWorkbenchState,
  descriptor: SerializableUndoDescriptor
): BatchImagerWorkbenchState {
  if (descriptor.kind !== "restore-workspace") {
    return state;
  }

  return {
    ...state,
    project: {
      ...state.project,
      imageCount: descriptor.projectImageCount
    },
    referenceImages: descriptor.referenceImages?.map((referenceImage) => ({ ...referenceImage })),
    selectedSessionId: descriptor.selectedSessionId ?? null,
    sessions: descriptor.sessions.map(cloneSession)
  };
}

function formatUndoRevisionWarning(entries: PersistedUndoEntry[], currentSinkRevision: number | undefined): string | undefined {
  if (currentSinkRevision === undefined) {
    return undefined;
  }

  const chronologicalEntries = [...entries].reverse();
  const revisions = chronologicalEntries.map((entry) => entry.sinkRevisionAfter);
  if (revisions.some((revision) => revision === undefined)) {
    return undefined;
  }

  const firstRevision = revisions[0]!;
  const latestRelevantRevision = Math.max(currentSinkRevision, revisions.at(-1)!);
  const observedRevisionSpan = latestRelevantRevision - firstRevision;
  const expectedRevisionSpan = revisions.length - 1;
  const extraRevisionCount = Math.max(0, observedRevisionSpan - expectedRevisionSpan);

  return extraRevisionCount > 0
    ? `⚠️ 撤销期间检测到 ${extraRevisionCount} 个中间工作区写入可能也被回退。`
    : undefined;
}

function resolveRecord(
  state: BatchImagerWorkbenchState,
  sessionId: string,
  recordIndex: number
): { filePath: string; result: Extract<BatchImagerWorkbenchActionResult, { ok: true }>; session: PersistedImageSession } | { result: Extract<BatchImagerWorkbenchActionResult, { ok: false }> } {
  const session = state.sessions.find((current) => current.id === sessionId);
  if (!session) {
    return {
      result: {
        ok: false,
        reason: "session not found",
        detail: `no session with id ${sessionId}`,
        suggestedNext: "call list_sessions to list current ids."
      }
    };
  }

  const records = session.generatedFilePaths ?? [];
  if (!Number.isInteger(recordIndex) || recordIndex < 1 || recordIndex > records.length) {
    return {
      result: {
        ok: false,
        reason: "recordIndex out of range",
        detail: `${sessionId} has ${records.length} records, requested ${recordIndex}.`,
        suggestedNext: "call get_session_records to verify."
      }
    };
  }

  return {
    filePath: records[recordIndex - 1],
    result: { ok: true, affectedSessionIds: [sessionId], summary: "record resolved" },
    session
  };
}

function findSession(state: BatchImagerWorkbenchState, sessionId: string): PersistedImageSession | undefined {
  return state.sessions.find((session) => session.id === sessionId);
}

function updateSession(
  state: BatchImagerWorkbenchState,
  sessionId: string,
  update: (session: PersistedImageSession) => PersistedImageSession
): BatchImagerWorkbenchState {
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === sessionId ? update(session) : session))
  };
}

function chooseFallback(session: PersistedImageSession, recordIndex: number, remainingRecords: string[]): string | undefined {
  if (session.generatedFilePath !== session.generatedFilePaths?.[recordIndex - 1]) {
    return session.generatedFilePath && remainingRecords.includes(session.generatedFilePath) ? session.generatedFilePath : remainingRecords.at(-1);
  }

  return remainingRecords[Math.max(0, recordIndex - 2)] ?? remainingRecords[0];
}

function cloneSession(session: PersistedImageSession): PersistedImageSession {
  return JSON.parse(JSON.stringify(session)) as PersistedImageSession;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function createUniqueWorkbenchSessionId(state: BatchImagerWorkbenchState): string {
  const existingIds = new Set(state.sessions.map((session) => session.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `sess_${existingIds.size + 1}_${Math.random().toString(36).slice(2, 8)}`;
}

function basenameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function ok(
  state: BatchImagerWorkbenchState,
  affectedSessionIds: string[],
  summary: string
): BatchImagerWorkbenchMutation {
  return { state, result: { ok: true, affectedSessionIds, summary } };
}

function fail(
  state: BatchImagerWorkbenchState,
  reason: string,
  detail?: string,
  suggestedNext?: string
): BatchImagerWorkbenchMutation {
  return { state, result: { ok: false, ...(detail ? { detail } : {}), reason, ...(suggestedNext ? { suggestedNext } : {}) } };
}
