import type { ImageSession } from "../types/image";
import { isSupportedImagePath } from "./imageFiles";

export function createImageSessions(filePaths: string[]): ImageSession[] {
  return filePaths.map((filePath, index) => ({
    id: `img-${index + 1}`,
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

export function appendImageSessions(existing: ImageSession[], incomingPaths: string[]): ImageSession[] {
  const existingPaths = new Set(existing.map((session) => session.filePath.toLowerCase()));
  const nextSessions = [...existing];

  for (const filePath of incomingPaths) {
    const normalized = filePath.toLowerCase();

    if (!isSupportedImagePath(filePath) || existingPaths.has(normalized)) {
      continue;
    }

    existingPaths.add(normalized);
    nextSessions.push({
      id: `img-${nextSessions.length + 1}`,
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
              content: `来自 Esse方案：${command.instruction}${referenceCount > 0 ? `\n参考图：${referenceCount} 张` : ""}`,
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

export function markSessionEsseTask(
  sessions: ImageSession[],
  sessionId: string,
  task: { instruction: string; referenceFilePaths?: string[]; sourceFilePath?: string },
  contextMessageId: string
): ImageSession[] {
  const referenceFilePaths = task.referenceFilePaths ?? [];
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
              content: `来自 Esse智能体：${task.instruction}${referenceCount > 0 ? `\n参考图：${referenceCount} 张` : ""}`,
              contextType: "esse-task" as const,
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

export function getSessionDisplayPath(session: ImageSession): string {
  return session.showOriginalInList ? session.filePath : getSessionGenerationSourcePath(session);
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
      ? {
          ...session,
          chatMessages: [
            ...session.chatMessages,
            {
              id: messageId,
              role: "assistant",
              content: result.content,
              ...(result.generatedFilePath ? { generatedFilePath: result.generatedFilePath } : {})
            }
          ],
          chatStatus: "idle",
          errorMessage: undefined,
          ...(result.generatedFilePath
            ? {
                generatedFilePath: result.generatedFilePath,
                generatedFilePaths: appendGeneratedFilePath(session.generatedFilePaths, result.generatedFilePath),
                showOriginalInList: false,
                status: "completed" as const
              }
            : {})
        }
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

function appendGeneratedFilePath(existing: string[] | undefined, generatedFilePath: string): string[] {
  return [...(existing ?? []).filter((filePath) => filePath !== generatedFilePath), generatedFilePath];
}

function hasGeneratedImageContext(session: ImageSession, generatedFilePath: string): boolean {
  return session.chatMessages.some(
    (message) => message.contextType === "generated-image" && message.generatedFilePath === generatedFilePath
  );
}
