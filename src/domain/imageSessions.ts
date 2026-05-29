import type { ImageSession } from "../types/image";
import { isSupportedImagePath } from "./imageFiles";

type CreateSessionId = () => string;

export function createImageSessionId(): string {
  const crypto = globalThis.crypto;

  if (typeof crypto?.randomUUID === "function") {
    return `sess_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }

  if (typeof crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `sess_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  return `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function createImageSessions(filePaths: string[], makeSessionId: CreateSessionId = createImageSessionId): ImageSession[] {
  const usedSessionIds = new Set<string>();

  return filePaths.map((filePath, index) => ({
    id: createUniqueSessionId(usedSessionIds, makeSessionId, index),
    filePath,
    fileName: getFileName(filePath),
    chatMessages: [],
    chatStatus: "idle",
    status: "idle"
  }));
}

export function getInitialSelectedSessionId(
  sessions: ImageSession[],
  currentSelectedId: string | null
): string | null {
  if (currentSelectedId && sessions.some((session) => session.id === currentSelectedId)) {
    return currentSelectedId;
  }

  return sessions[0]?.id ?? null;
}

export function appendImageSessions(
  existing: ImageSession[],
  incomingPaths: string[],
  makeSessionId: CreateSessionId = createImageSessionId
): ImageSession[] {
  const existingPaths = new Set(existing.map((session) => session.filePath.toLowerCase()));
  const nextSessions = [...existing];
  const usedSessionIds = new Set(existing.map((session) => session.id));
  let fallbackIndex = nextSessions.length;

  for (const filePath of incomingPaths) {
    const normalized = filePath.toLowerCase();

    if (!isSupportedImagePath(filePath) || existingPaths.has(normalized)) {
      continue;
    }

    existingPaths.add(normalized);
    fallbackIndex += 1;
    nextSessions.push({
      id: createUniqueSessionId(usedSessionIds, makeSessionId, fallbackIndex),
      filePath,
      fileName: getFileName(filePath),
      chatMessages: [],
      chatStatus: "idle",
      status: "idle"
    });
  }

  return nextSessions;
}

export function markSessionGenerating(
  sessions: ImageSession[],
  sessionId: string,
  prompt: string,
  contextMessageId?: string,
  referenceFilePaths: string[] = [],
  sourceFilePath?: string
): ImageSession[] {
  const referenceCount = referenceFilePaths.length;

  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          chatMessages: contextMessageId
            ? [
                ...session.chatMessages,
                {
                  id: contextMessageId,
                  role: "context" as const,
                  content: `批量处理：${prompt}${referenceCount > 0 ? `\n参考图：${referenceCount} 张` : ""}`,
                  contextType: "batch-prompt" as const,
                  ...(sourceFilePath ? { sourceFilePath } : {}),
                  ...(referenceCount > 0 ? { referenceFilePaths } : {})
                }
              ]
            : session.chatMessages,
          errorMessage: undefined,
          lastPrompt: prompt,
          status: "generating"
        }
      : session
  );
}

export function markSessionProjectCommand(
  sessions: ImageSession[],
  sessionId: string,
  command: { instruction: string; referenceFilePaths?: string[]; sourceFilePath?: string },
  contextMessageId: string
): ImageSession[] {
  const referenceFilePaths = command.referenceFilePaths ?? [];
  const referenceCount = referenceFilePaths.length;

  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          chatMessages: [
            ...session.chatMessages,
            {
              id: contextMessageId,
              role: "context" as const,
              content: `来自批量方案：${command.instruction}${referenceCount > 0 ? `\n参考图：${referenceCount} 张` : ""}`,
              contextType: "project-command" as const,
              ...(command.sourceFilePath ? { sourceFilePath: command.sourceFilePath } : {}),
              ...(referenceCount > 0 ? { referenceFilePaths } : {})
            }
          ],
          errorMessage: undefined,
          lastPrompt: command.instruction,
          status: "generating" as const
        }
      : session
  );
}

export function markSessionAgentTask(
  sessions: ImageSession[],
  sessionId: string,
  task: { instruction: string; referenceFilePaths?: string[]; sourceFilePath?: string },
  contextMessageId: string,
  providerLabel = "智能体"
): ImageSession[] {
  const referenceFilePaths = task.referenceFilePaths ?? [];
  const referenceCount = referenceFilePaths.length;
  const sourceLabel = providerLabel === "智能体" ? "来自智能体" : `来自 ${providerLabel}智能体`;

  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          chatMessages: [
            ...session.chatMessages,
            {
              id: contextMessageId,
              role: "context" as const,
              content: `${sourceLabel}：${task.instruction}${referenceCount > 0 ? `\n参考图：${referenceCount} 张` : ""}`,
              contextType: "agent-task" as const,
              ...(referenceCount > 0 ? { referenceFilePaths } : {}),
              ...(task.sourceFilePath ? { sourceFilePath: task.sourceFilePath } : {})
            }
          ],
          errorMessage: undefined,
          lastPrompt: task.instruction,
          status: "generating" as const
        }
      : session
  );
}

export function markSessionEsseTask(
  sessions: ImageSession[],
  sessionId: string,
  task: { instruction: string; referenceFilePaths?: string[]; sourceFilePath?: string },
  contextMessageId: string
): ImageSession[] {
  return markSessionAgentTask(sessions, sessionId, task, contextMessageId, "Esse");
}

export function applyGeneratedImageResult(
  sessions: ImageSession[],
  sessionId: string,
  generatedFilePath: string,
  contextMessageId?: string
): ImageSession[] {
  const messageId = contextMessageId ?? `generated-${generatedFilePath}`;

  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          chatMessages: hasGeneratedImageContext(session, generatedFilePath)
            ? session.chatMessages
            : [
                ...session.chatMessages,
                {
                  id: messageId,
                  role: "context" as const,
                  content: "生成完成，已加入会话上下文。",
                  contextType: "generated-image" as const,
                  generatedFilePath
                }
              ],
          errorMessage: undefined,
          generatedFilePath,
          generatedFilePaths: appendGeneratedFilePath(session.generatedFilePaths, generatedFilePath),
          showOriginalInList: false,
          status: "completed"
        }
      : session
  );
}

export function applySessionImageChoice(
  sessions: ImageSession[],
  sessionId: string,
  imagePath: string
): ImageSession[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          ...(imagePath === session.filePath
            ? { generatedFilePath: undefined, showOriginalInList: false }
            : { generatedFilePath: imagePath, showOriginalInList: false })
        }
      : session
  );
}

export function toggleSessionListImageSource(sessions: ImageSession[], sessionId: string): ImageSession[] {
  return sessions.map((session) =>
    session.id === sessionId && session.generatedFilePath
      ? {
          ...session,
          showOriginalInList: !session.showOriginalInList
        }
      : session
  );
}

export function moveImageSession(sessions: ImageSession[], sourceSessionId: string, targetSessionId: string): ImageSession[] {
  if (sourceSessionId === targetSessionId) {
    return sessions;
  }

  const sourceIndex = sessions.findIndex((session) => session.id === sourceSessionId);
  const targetIndex = sessions.findIndex((session) => session.id === targetSessionId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return sessions;
  }

  const nextSessions = [...sessions];
  const [movedSession] = nextSessions.splice(sourceIndex, 1);

  if (!movedSession) {
    return sessions;
  }

  nextSessions.splice(targetIndex, 0, movedSession);
  return nextSessions;
}

export function getSessionDisplayPath(session: ImageSession): string {
  return getSessionGenerationSourcePath(session);
}

export function getSessionGenerationSourcePath(session: ImageSession): string {
  return session.generatedFilePath ?? session.filePath;
}

export function removeImageSession(
  sessions: ImageSession[],
  sessionId: string
): { selectedSessionId: string | null; sessions: ImageSession[] } {
  const removedIndex = sessions.findIndex((session) => session.id === sessionId);

  if (removedIndex < 0) {
    return {
      selectedSessionId: sessions[0]?.id ?? null,
      sessions
    };
  }

  const nextSessions = sessions.filter((session) => session.id !== sessionId);
  const nextSelectedIndex = Math.min(removedIndex, nextSessions.length - 1);

  return {
    selectedSessionId: nextSelectedIndex >= 0 ? nextSessions[nextSelectedIndex].id : null,
    sessions: nextSessions
  };
}

export function removeAllImageSessions(): { selectedSessionId: null; sessions: ImageSession[] } {
  return {
    selectedSessionId: null,
    sessions: []
  };
}

export function applySessionGenerationError(
  sessions: ImageSession[],
  sessionId: string,
  errorMessage: string
): ImageSession[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          errorMessage,
          status: "failed"
        }
      : session
  );
}

export function stopSessionWork(sessions: ImageSession[], sessionId: string): ImageSession[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          chatStatus: "idle",
          status: session.status === "generating" || session.status === "queued" ? "idle" : session.status
        }
      : session
  );
}

export function addSessionUserMessage(
  sessions: ImageSession[],
  sessionId: string,
  content: string,
  messageId: string,
  referenceFilePaths: string[] = []
): ImageSession[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          chatMessages: [
            ...session.chatMessages,
            {
              id: messageId,
              role: "user",
              content,
              ...(referenceFilePaths.length ? { referenceFilePaths } : {})
            }
          ],
          chatStatus: "sending",
          errorMessage: undefined
        }
      : session
  );
}

export function applySessionChatSuccess(
  sessions: ImageSession[],
  sessionId: string,
  result: { content: string; generatedFilePath?: string },
  messageId: string
): ImageSession[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? applyChatResultToSession(session, result, messageId)
      : session
  );
}

export function applySessionChatError(
  sessions: ImageSession[],
  sessionId: string,
  errorMessage: string,
  messageId: string
): ImageSession[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          chatMessages: [...session.chatMessages, { id: messageId, role: "error", content: errorMessage }],
          chatStatus: "idle",
          errorMessage,
          status: "failed"
        }
      : session
  );
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}

function createUniqueSessionId(usedSessionIds: Set<string>, makeSessionId: CreateSessionId, fallbackIndex: number): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = makeSessionId().trim();

    if (id && !usedSessionIds.has(id)) {
      usedSessionIds.add(id);
      return id;
    }
  }

  let index = fallbackIndex + 1;
  let fallbackId = `sess_fallback_${index}`;
  while (usedSessionIds.has(fallbackId)) {
    index += 1;
    fallbackId = `sess_fallback_${index}`;
  }

  usedSessionIds.add(fallbackId);
  return fallbackId;
}

function applyChatResultToSession(
  session: ImageSession,
  result: { content: string; generatedFilePath?: string },
  messageId: string
): ImageSession {
  const chatMessages = [
    ...session.chatMessages,
    {
      id: messageId,
      role: "assistant" as const,
      content: result.content,
      ...(result.generatedFilePath ? { generatedFilePath: result.generatedFilePath } : {})
    }
  ];

  if (!result.generatedFilePath) {
    return {
      ...session,
      chatMessages,
      chatStatus: "idle",
      errorMessage: undefined
    };
  }

  const generatedFilePaths = appendGeneratedFilePath(session.generatedFilePaths, result.generatedFilePath);

  if (isPendingNewImageSession(session)) {
    return {
      ...session,
      chatMessages,
      chatStatus: "idle",
      errorMessage: undefined,
      fileName: getFileName(result.generatedFilePath),
      filePath: result.generatedFilePath,
      generatedFilePath: undefined,
      generatedFilePaths,
      generationMode: undefined,
      showOriginalInList: false,
      status: "completed"
    };
  }

  return {
    ...session,
    chatMessages,
    chatStatus: "idle",
    errorMessage: undefined,
    generatedFilePath: result.generatedFilePath,
    generatedFilePaths,
    showOriginalInList: false,
    status: "completed"
  };
}

function isPendingNewImageSession(session: ImageSession): boolean {
  return Boolean(session.generationMode && !session.generatedFilePath);
}

function appendGeneratedFilePath(existing: string[] | undefined, generatedFilePath: string): string[] {
  return [...(existing ?? []).filter((filePath) => filePath !== generatedFilePath), generatedFilePath];
}

function hasGeneratedImageContext(session: ImageSession, generatedFilePath: string): boolean {
  return session.chatMessages.some(
    (message) => message.contextType === "generated-image" && message.generatedFilePath === generatedFilePath
  );
}
