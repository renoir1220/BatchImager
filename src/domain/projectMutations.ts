import type { ImageSession } from "../types/image";
import type { BatchPlanReferenceImage, ProjectManagerState } from "../types/projectManager";

export interface ProjectMetadata {
  directory?: string;
  id?: string;
  name?: string;
}

export interface ProjectState {
  project: ProjectMetadata;
  projectManagerState: ProjectManagerState;
  referenceImages: BatchPlanReferenceImage[];
  selectedSessionId: string | null;
  sessions: ImageSession[];
}

export type ReducerResult =
  | { ok: true; affectedSessionIds: string[]; summary: string }
  | { ok: false; detail?: string; reason: string; suggestedNext?: string };

export interface ProjectMutationResult {
  result: ReducerResult;
  state: ProjectState;
}

export function applyRestoreRecord(
  state: ProjectState,
  params: { recordIndex: number; sessionId: string }
): ProjectMutationResult {
  const resolved = resolveSessionRecord(state, params.sessionId, params.recordIndex);
  if (!("filePath" in resolved)) {
    return { state, result: resolved.result };
  }

  const nextState = updateSession(state, params.sessionId, (session) => ({
    ...session,
    generatedFilePath: resolved.filePath,
    showOriginalInList: false
  }));

  return ok(nextState, [params.sessionId], `已切换到记录 ${params.recordIndex}。`);
}

export function applyRestoreOriginal(state: ProjectState, params: { sessionId: string }): ProjectMutationResult {
  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const nextState = updateSession(state, params.sessionId, (current) => ({
    ...current,
    generatedFilePath: undefined,
    showOriginalInList: false
  }));

  return ok(nextState, [params.sessionId], "已恢复为原图。");
}

export function applyRenameSession(state: ProjectState, params: { fileName: string; sessionId: string }): ProjectMutationResult {
  const fileName = params.fileName.trim();
  if (!fileName) {
    return fail(state, "fileName is required", undefined, "provide a non-empty fileName.");
  }

  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const nextState = updateSession(state, params.sessionId, (current) => ({
    ...current,
    fileName
  }));

  return ok(nextState, [params.sessionId], `已重命名为 ${fileName}。`);
}

export function applyReorderSessions(state: ProjectState, params: { sessionIds: string[] }): ProjectMutationResult {
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
      sessions: nextSessions as ImageSession[]
    },
    requestedIds,
    "已调整图片顺序。"
  );
}

export function applySetSessionPrompt(state: ProjectState, params: { prompt: string; sessionId: string }): ProjectMutationResult {
  const prompt = params.prompt.trim();
  if (!prompt) {
    return fail(state, "prompt is required", undefined, "provide a non-empty prompt.");
  }

  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const nextState = updateSession(state, params.sessionId, (current) => ({
    ...current,
    lastPrompt: prompt
  }));

  return ok(nextState, [params.sessionId], "已更新这张图的默认提示词。");
}

export function applyAddBlankSession(
  state: ProjectState,
  params: { fileName?: string; filePath: string; sessionId: string }
): ProjectMutationResult {
  const sessionId = params.sessionId.trim();
  const filePath = params.filePath.trim();
  if (!sessionId || state.sessions.some((session) => session.id === sessionId)) {
    return fail(state, "sessionId must be unique", undefined, "generate a new stable session id.");
  }
  if (!filePath) {
    return fail(state, "filePath is required", undefined, "create a placeholder file first or pass an explicit blank image path.");
  }

  const fileName = params.fileName?.trim() || getFileName(filePath) || "未命名图片.png";
  const nextSession: ImageSession = {
    chatMessages: [],
    chatStatus: "idle",
    fileName,
    filePath,
    id: sessionId,
    status: "idle"
  };

  return ok(
    {
      ...state,
      selectedSessionId: sessionId,
      sessions: [...state.sessions, nextSession]
    },
    [sessionId],
    "已添加空白图片位。"
  );
}

export function applyDeleteRecord(
  state: ProjectState,
  params: { recordIndex: number; sessionId: string }
): ProjectMutationResult {
  const resolved = resolveSessionRecord(state, params.sessionId, params.recordIndex);
  if (!("filePath" in resolved)) {
    return { state, result: resolved.result };
  }

  const deletedPath = resolved.filePath;
  const nextGeneratedFilePaths = resolved.session.generatedFilePaths?.filter((_filePath, index) => index !== params.recordIndex - 1) ?? [];
  const fallbackPath = chooseRecordFallback(resolved.session, params.recordIndex, nextGeneratedFilePaths);
  const nextState = updateSession(state, params.sessionId, (session) => ({
    ...session,
    chatMessages: clearGeneratedMessageReferences(session.chatMessages, new Set([deletedPath])),
    generatedFilePath: fallbackPath,
    generatedFilePaths: nextGeneratedFilePaths.length ? nextGeneratedFilePaths : undefined,
    showOriginalInList: fallbackPath ? false : true
  }));

  return ok(nextState, [params.sessionId], `已删除记录 ${params.recordIndex}。`);
}

export function applyDeleteSession(state: ProjectState, params: { sessionId: string }): ProjectMutationResult {
  const removedIndex = state.sessions.findIndex((session) => session.id === params.sessionId);
  if (removedIndex < 0) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const nextSessions = state.sessions.filter((session) => session.id !== params.sessionId);
  const nextSelectedSessionId =
    state.selectedSessionId === params.sessionId
      ? nextSessions[Math.min(removedIndex, nextSessions.length - 1)]?.id ?? null
      : state.selectedSessionId;

  return ok(
    {
      ...state,
      selectedSessionId: nextSelectedSessionId,
      sessions: nextSessions
    },
    [params.sessionId],
    "已删除图片。"
  );
}

export function applyMergeSessions(
  state: ProjectState,
  params: { sourceSessionIds: string[]; targetSessionId: string }
): ProjectMutationResult {
  const target = findSession(state, params.targetSessionId);
  if (!target) {
    return fail(state, "target session not found", `no session with id ${params.targetSessionId}`, "call list_sessions to list current ids.");
  }

  const sourceIds = [...new Set(params.sourceSessionIds.filter((id) => id !== params.targetSessionId))];
  if (sourceIds.length === 0) {
    return fail(state, "sourceSessionIds are required", undefined, "provide at least one source session id different from targetSessionId.");
  }

  const sources = sourceIds.map((id) => findSession(state, id));
  const missingId = sourceIds.find((id, index) => !sources[index]);
  if (missingId) {
    return fail(state, "source session not found", `no session with id ${missingId}`, "call list_sessions to list current ids.");
  }

  const sourceSessions = sources as ImageSession[];
  const mergedRecordPaths = uniquePaths([
    ...(target.generatedFilePaths ?? []),
    ...sourceSessions.flatMap((session) => session.generatedFilePaths ?? []),
    ...sourceSessions.flatMap((session) => (session.generatedFilePath ? [session.generatedFilePath] : []))
  ]);
  const sourceMessages = sourceSessions.flatMap((session) => session.chatMessages);
  const affectedSessionIds = [params.targetSessionId, ...sourceIds];
  const nextSessions = state.sessions
    .filter((session) => !sourceIds.includes(session.id))
    .map((session) =>
      session.id === params.targetSessionId
        ? {
            ...session,
            chatMessages: [...session.chatMessages, ...sourceMessages],
            generatedFilePaths: mergedRecordPaths.length ? mergedRecordPaths : session.generatedFilePaths,
            generatedFilePath: session.generatedFilePath ?? mergedRecordPaths.at(-1)
          }
        : session
    );

  return ok(
    {
      ...state,
      selectedSessionId: sourceIds.includes(state.selectedSessionId ?? "") ? params.targetSessionId : state.selectedSessionId,
      sessions: nextSessions
    },
    affectedSessionIds,
    `已合并 ${sourceIds.length} 张图片。`
  );
}

export function applyAppendGeneratedRecord(
  state: ProjectState,
  params: { generatedFilePath: string; sessionId: string }
): ProjectMutationResult {
  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const nextState = updateSession(state, params.sessionId, (current) => ({
    ...current,
    generatedFilePath: params.generatedFilePath,
    generatedFilePaths: appendUniquePath(current.generatedFilePaths, params.generatedFilePath),
    showOriginalInList: false,
    status: "completed"
  }));

  return ok(nextState, [params.sessionId], "已追加生成记录。");
}

export function applyReplaceCurrentImage(
  state: ProjectState,
  params: { generatedFilePath: string; sessionId: string }
): ProjectMutationResult {
  return applyAppendGeneratedRecord(state, params);
}

function resolveSessionRecord(
  state: ProjectState,
  sessionId: string,
  recordIndex: number
): { filePath: string; result: Extract<ReducerResult, { ok: true }>; session: ImageSession } | { result: Extract<ReducerResult, { ok: false }> } {
  const session = findSession(state, sessionId);
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

function findSession(state: ProjectState, sessionId: string): ImageSession | undefined {
  return state.sessions.find((session) => session.id === sessionId);
}

function updateSession(state: ProjectState, sessionId: string, update: (session: ImageSession) => ImageSession): ProjectState {
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === sessionId ? update(session) : session))
  };
}

function chooseRecordFallback(session: ImageSession, recordIndex: number, remainingRecords: string[]): string | undefined {
  if (session.generatedFilePath !== session.generatedFilePaths?.[recordIndex - 1]) {
    return session.generatedFilePath && remainingRecords.includes(session.generatedFilePath) ? session.generatedFilePath : remainingRecords.at(-1);
  }

  return remainingRecords[Math.max(0, recordIndex - 2)] ?? remainingRecords[0];
}

function clearGeneratedMessageReferences(
  messages: ImageSession["chatMessages"],
  deletedPaths: Set<string>
): ImageSession["chatMessages"] {
  return messages.map((message) =>
    message.generatedFilePath && deletedPaths.has(message.generatedFilePath)
      ? { ...message, generatedFilePath: undefined }
      : message
  );
}

function appendUniquePath(paths: string[] | undefined, filePath: string): string[] {
  return uniquePaths([...(paths ?? []), filePath]);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const filePath of paths) {
    if (seen.has(filePath)) {
      continue;
    }
    seen.add(filePath);
    result.push(filePath);
  }
  return result;
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}

function ok(state: ProjectState, affectedSessionIds: string[], summary: string): ProjectMutationResult {
  return {
    state,
    result: {
      affectedSessionIds,
      ok: true,
      summary
    }
  };
}

function fail(state: ProjectState, reason: string, detail?: string, suggestedNext?: string): ProjectMutationResult {
  return {
    state,
    result: {
      ...(detail ? { detail } : {}),
      ok: false,
      reason,
      ...(suggestedNext ? { suggestedNext } : {})
    }
  };
}
