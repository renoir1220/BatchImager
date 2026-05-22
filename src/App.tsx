import { useEffect, useMemo, useState } from "react";
import {
  addSessionUserMessage,
  applySessionImageChoice,
  applySessionChatError,
  applySessionChatSuccess,
  applyGeneratedImageResult,
  applySessionGenerationError,
  getInitialSelectedSessionId,
  getSessionGenerationSourcePath,
  markSessionGenerating,
  removeAllImageSessions,
  removeImageSession,
  toggleSessionListImageSource
} from "./domain/imageSessions";
import { getSessionActivityLogs } from "./domain/sessionActivity";
import type { ImageSession, ImageSessionChatMessage } from "./types/image";
import { AppToolbar } from "./components/AppToolbar";
import { BatchDialog } from "./components/BatchDialog";
import { EmptyWorkspace } from "./components/EmptyWorkspace";
import { ImagePreviewDialog } from "./components/ImagePreviewDialog";
import { ImageWorkspace } from "./components/ImageWorkspace";
import { LogPanel } from "./components/LogPanel";
import { ProjectListDialog } from "./components/ProjectListDialog";
import { SessionPanel } from "./components/SessionPanel";
import type { AppLogEntry, ChatReferenceImage, ProjectListEntry, ProjectMetadata, ProjectSnapshot } from "../electron/ipcTypes";

const DEFAULT_COLUMNS = 4;

export function App() {
  const [currentProject, setCurrentProject] = useState<ProjectMetadata | null>(null);
  const [sessions, setSessions] = useState<ImageSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const [isProjectListOpen, setIsProjectListOpen] = useState(false);
  const [isProjectListLoading, setIsProjectListLoading] = useState(false);
  const [projectListEntries, setProjectListEntries] = useState<ProjectListEntry[]>([]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  );
  const previewSession = useMemo(
    () => sessions.find((session) => session.id === previewSessionId) ?? null,
    [previewSessionId, sessions]
  );
  const projectLabel = currentProject?.name ?? (currentProject ? formatProjectLabel(currentProject.createdAt) : undefined);
  const selectedSessionActivityLogs = useMemo(
    () => getSessionActivityLogs(logs, selectedSessionId),
    [logs, selectedSessionId]
  );

  useEffect(() => {
    let isMounted = true;

    void window.batchImager?.getLogs().then((entries) => {
      if (isMounted) {
        setLogs(entries);
      }
    });

    const unsubscribe = window.batchImager?.subscribeLogs((entry) => {
      setLogs((currentLogs) => [...currentLogs, entry].slice(-500));
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.batchImager?.subscribeProjectThumbnailUpdates(() => {
      if (isProjectListOpen) {
        void loadProjectList();
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [isProjectListOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Delete" || !selectedSessionId || isEditableEventTarget(event.target)) {
        return;
      }

      event.preventDefault();
      deleteSession(selectedSessionId);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSessionId, sessions]);

  function applyProjectSnapshot(snapshot: ProjectSnapshot): void {
    const nextSessions = snapshot.sessions as ImageSession[];
    const nextSelectedSessionId = getInitialSelectedSessionId(nextSessions, snapshot.selectedSessionId ?? null);

    setCurrentProject(snapshot.project);
    setSessions(nextSessions);
    setSelectedSessionId(nextSelectedSessionId);
    setPreviewSessionId(null);
    setIsBatchDialogOpen(false);
  }

  function persistProjectSnapshot(nextSessions: ImageSession[], nextSelectedSessionId: string | null): void {
    if (!currentProject) {
      return;
    }

    void window.batchImager
      ?.saveProjectSnapshot({
        selectedSessionId: nextSelectedSessionId,
        sessions: nextSessions
      })
      .then((snapshot) => {
        setCurrentProject(snapshot.project);
      })
      .catch((error) => {
        console.error("[BatchImager UI] Project snapshot save failed", error);
      });
  }

  async function importImagePaths(paths: string[]): Promise<void> {
    if (!currentProject) {
      window.alert("请先新建或打开项目。");
      return;
    }

    const snapshot = await window.batchImager?.importImages({ sourcePaths: paths });
    if (snapshot) {
      applyProjectSnapshot(snapshot);
    }
  }

  async function handleNewProject(): Promise<void> {
    const snapshot = await window.batchImager?.createProject();
    if (snapshot) {
      applyProjectSnapshot(snapshot);
    }
  }

  async function handleOpenProject(): Promise<void> {
    setIsProjectListOpen(true);
    await loadProjectList();
  }

  async function handleOpenProjectFromList(directory: string): Promise<void> {
    const snapshot = await window.batchImager?.openProject({ directory });
    if (snapshot) {
      applyProjectSnapshot(snapshot);
      setIsProjectListOpen(false);
    }
  }

  async function loadProjectList(): Promise<void> {
    setIsProjectListLoading(true);
    try {
      const entries = await window.batchImager?.listProjects();
      if (entries) {
        setProjectListEntries(entries);
      }
    } finally {
      setIsProjectListLoading(false);
    }
  }

  async function handleRememberProjectDirectory(): Promise<void> {
    const entries = await window.batchImager?.rememberProjectDirectory();
    if (entries) {
      setProjectListEntries(entries);
    }
  }

  async function handleRenameProject(directory: string, name: string): Promise<void> {
    const entries = await window.batchImager?.renameProject({ directory, name });
    if (entries) {
      setProjectListEntries(entries);
      const renamedProject = entries.find((entry) => entry.directory === currentProject?.directory)?.summary;
      if (renamedProject) {
        setCurrentProject(renamedProject);
      }
    }
  }

  async function handleSelectImages(): Promise<void> {
    if (!currentProject) {
      window.alert("请先新建或打开项目。");
      return;
    }

    const snapshot = await window.batchImager?.importImages({ sourcePaths: [] });
    if (snapshot) {
      applyProjectSnapshot(snapshot);
    }
  }

  async function handleDrop(files: File[]): Promise<void> {
    const paths = files
      .map((file) => window.batchImager?.getPathForFile(file))
      .filter((path): path is string => Boolean(path));

    await importImagePaths(paths);
  }

  function handleBatchGenerate(prompt: string, referenceImagePaths: string[], outputSize?: string): void {
    setIsBatchDialogOpen(false);
    console.info("[BatchImager UI] Batch generation started", {
      count: sessions.length,
      referenceImageCount: referenceImagePaths.length
    });

    for (const session of sessions) {
      void generateForSession(session, prompt, referenceImagePaths, outputSize);
    }
  }

  function handleSendChatMessage(sessionId: string, content: string, outputSize?: string): void {
    const session = sessions.find((currentSession) => currentSession.id === sessionId);

    if (session) {
      void sendChatMessage(session, content, outputSize);
    }
  }

  function handleUsePreviewImage(sessionId: string, imagePath: string): void {
    setSessions((currentSessions) => {
      const nextSessions = applySessionImageChoice(currentSessions, sessionId, imagePath);
      persistProjectSnapshot(nextSessions, selectedSessionId);
      return nextSessions;
    });
    console.info("[BatchImager UI] Image source changed", { imagePath, sessionId });
  }

  function deleteSession(sessionId: string): void {
    const result = removeImageSession(sessions, sessionId);
    setSessions(result.sessions);
    setSelectedSessionId(result.selectedSessionId);
    persistProjectSnapshot(result.sessions, result.selectedSessionId);

    if (previewSessionId === sessionId) {
      setPreviewSessionId(null);
    }
  }

  function handleClearSessions(): void {
    if (sessions.length === 0 || !window.confirm(`确定清空当前 ${sessions.length} 张图片和会话记录吗？`)) {
      return;
    }

    const result = removeAllImageSessions();
    setSessions(result.sessions);
    setSelectedSessionId(result.selectedSessionId);
    persistProjectSnapshot(result.sessions, result.selectedSessionId);
    setPreviewSessionId(null);
    setIsBatchDialogOpen(false);
  }

  async function generateForSession(
    session: ImageSession,
    prompt: string,
    referenceImagePaths: string[] = [],
    outputSize?: string
  ): Promise<void> {
    const sourcePath = getSessionGenerationSourcePath(session);
    console.info("[BatchImager UI] Image generation requested", { fileName: session.fileName, sessionId: session.id });

    setSessions((currentSessions) =>
      updateAndPersistSessions(
        markSessionGenerating(currentSessions, session.id, prompt, createMessageId("batch"), referenceImagePaths, sourcePath),
        selectedSessionId
      )
    );

    try {
      const result = await window.batchImager?.generateImage({
        imagePath: sourcePath,
        prompt,
        ...(referenceImagePaths.length ? { referenceImagePaths } : {}),
        ...(outputSize ? { size: outputSize } : {}),
        sessionId: session.id
      });

      if (!result) {
        throw new Error("当前运行环境不支持图像生成");
      }

      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applyGeneratedImageResult(currentSessions, result.sessionId, result.outputPath, createMessageId("image")),
          selectedSessionId
        )
      );
      console.info("[BatchImager UI] Image generation completed", { outputPath: result.outputPath, sessionId: session.id });
    } catch (error) {
      console.error("[BatchImager UI] Image generation failed", error);
      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applySessionGenerationError(currentSessions, session.id, error instanceof Error ? error.message : "未知错误"),
          selectedSessionId
        )
      );
    }
  }

  async function sendChatMessage(session: ImageSession, content: string, outputSize?: string): Promise<void> {
    const sourcePath = getSessionGenerationSourcePath(session);
    const userMessageId = createMessageId("user");
    const assistantMessageId = createMessageId("assistant");
    const history = [
      ...session.chatMessages
        .filter(isChatHistoryMessage)
        .map((message) => ({ role: message.role, content: message.content })),
      { role: "user" as const, content }
    ];
    const referenceImages = getSessionReferenceImages(session);
    const referenceImagePaths = referenceImages.map((referenceImage) => referenceImage.filePath);

    setSessions((currentSessions) =>
      updateAndPersistSessions(addSessionUserMessage(currentSessions, session.id, content, userMessageId), selectedSessionId)
    );
    console.info("[BatchImager UI] Chat message sent", { sessionId: session.id });

    try {
      const result = await window.batchImager?.sendChatMessage({
        context: {
          currentImageLabel: session.generatedFilePath ? "最近生成图" : "初始导入图",
          fileName: session.fileName,
          originalImageLabel: "初始导入图",
          ...(session.lastPrompt ? { previousGenerationPrompt: session.lastPrompt } : {}),
          ...(referenceImagePaths.length ? { referenceImageCount: referenceImagePaths.length } : {})
        },
        imagePath: sourcePath,
        messages: history,
        ...(outputSize ? { outputSize } : {}),
        ...(referenceImages.length ? { referenceImages } : {}),
        sessionId: session.id
      });

      if (!result) {
        throw new Error("当前运行环境不支持会话");
      }

      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applySessionChatSuccess(
            currentSessions,
            result.sessionId,
            {
              content: result.assistantMessage,
              generatedFilePath: result.generatedImagePath
            },
            assistantMessageId
          ),
          selectedSessionId
        )
      );
      console.info("[BatchImager UI] Chat message completed", {
        generatedImagePath: result.generatedImagePath,
        sessionId: result.sessionId
      });
    } catch (error) {
      console.error("[BatchImager UI] Chat message failed", error);
      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applySessionChatError(
            currentSessions,
            session.id,
            error instanceof Error ? error.message : "未知错误",
            createMessageId("error")
          ),
          selectedSessionId
        )
      );
    }
  }

  function updateAndPersistSessions(nextSessions: ImageSession[], nextSelectedSessionId: string | null): ImageSession[] {
    persistProjectSnapshot(nextSessions, nextSelectedSessionId);
    return nextSessions;
  }

  return (
    <div className="app-shell">
      <AppToolbar
        columns={columns}
        hasProject={Boolean(currentProject)}
        imageCount={sessions.length}
        logCount={logs.length}
        onBatchProcess={() => setIsBatchDialogOpen(true)}
        onClear={handleClearSessions}
        onColumnsChange={setColumns}
        onImport={handleSelectImages}
        onNewProject={handleNewProject}
        onOpenProject={handleOpenProject}
        onOpenLogs={() => setIsLogPanelOpen(true)}
        projectLabel={projectLabel}
      />

      <main className="app-main">
        <section className="workspace-pane" aria-label="图片工作区">
          {sessions.length === 0 ? (
            <EmptyWorkspace
              hasProject={Boolean(currentProject)}
              isDragging={isDragging}
              onDropFiles={handleDrop}
              onDraggingChange={setIsDragging}
            />
          ) : (
            <ImageWorkspace
              columns={columns}
              isDragging={isDragging}
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              onDropFiles={handleDrop}
              onDraggingChange={setIsDragging}
              onOpenPreview={setPreviewSessionId}
              onSelectSession={(sessionId) => {
                setSelectedSessionId(sessionId);
                persistProjectSnapshot(sessions, sessionId);
              }}
              onToggleImageSource={(sessionId) =>
                setSessions((currentSessions) =>
                  updateAndPersistSessions(toggleSessionListImageSource(currentSessions, sessionId), selectedSessionId)
                )
              }
            />
          )}
        </section>

        <SessionPanel
          activityLogs={selectedSessionActivityLogs}
          selectedSession={selectedSession}
          onSendMessage={handleSendChatMessage}
        />
      </main>

      {isBatchDialogOpen ? (
        <BatchDialog imageCount={sessions.length} onClose={() => setIsBatchDialogOpen(false)} onGenerate={handleBatchGenerate} />
      ) : null}

      {isLogPanelOpen ? <LogPanel logs={logs} onClose={() => setIsLogPanelOpen(false)} /> : null}

      {isProjectListOpen ? (
        <ProjectListDialog
          isLoading={isProjectListLoading}
          projects={projectListEntries}
          onAddDirectory={handleRememberProjectDirectory}
          onClose={() => setIsProjectListOpen(false)}
          onOpenProject={handleOpenProjectFromList}
          onRefresh={loadProjectList}
          onRenameProject={handleRenameProject}
        />
      ) : null}

      {previewSession ? (
        <ImagePreviewDialog
          session={previewSession}
          onClose={() => setPreviewSessionId(null)}
          onUseImage={(imagePath) => handleUsePreviewImage(previewSession.id, imagePath)}
        />
      ) : null}
    </div>
  );
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isChatHistoryMessage(
  message: ImageSessionChatMessage
): message is ImageSessionChatMessage & { role: "user" | "assistant" } {
  return message.role === "user" || message.role === "assistant";
}

function getSessionReferenceImages(session: ImageSession): ChatReferenceImage[] {
  const paths = new Set<string>();

  for (const message of session.chatMessages) {
    for (const referenceFilePath of message.referenceFilePaths ?? []) {
      paths.add(referenceFilePath);
    }
  }

  return [...paths].map((filePath, index) => ({
    filePath,
    id: `ref-${index + 1}`,
    label: `参考图 ${index + 1}：${getFileName(filePath)}`
  }));
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function formatProjectLabel(createdAt: string): string {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return "当前项目";
  }

  return `项目 ${date.toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  })}`;
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}
