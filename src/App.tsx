import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  addSessionUserMessage,
  applySessionImageChoice,
  applySessionChatError,
  applySessionChatSuccess,
  applyGeneratedImageResult,
  applySessionGenerationError,
  createImageSessionId,
  getInitialSelectedSessionId,
  getSessionGenerationSourcePath,
  markSessionEsseTask,
  markSessionProjectCommand,
  markSessionGenerating,
  moveImageSession,
  removeImageSession,
  stopSessionWork,
  toggleSessionListImageSource
} from "./domain/imageSessions";
import {
  applyWorkerReport,
  appendProjectManagerAssistantMessage,
  createEmptyProjectManagerState,
  createProjectManagerUserMessage,
  markBatchPlanRunning,
  pauseRunningProjectPlans,
  setProjectManagerDraftPlan
} from "./domain/projectManagerState";
import { getProjectManagerActivityLogs, getSessionActivityLogs } from "./domain/sessionActivity";
import { selectRecentProjects } from "./domain/recentProjects";
import { resolveProjectManagerReferenceImages } from "./domain/projectManagerReferences";
import {
  selectPlanCommandsForExecution,
  type ProjectPlanExecutionMode
} from "./domain/projectPlanExecution";
import {
  clampSessionPanelWidth,
  DEFAULT_SESSION_PANEL_WIDTH,
  readStoredSessionPanelWidth,
  saveStoredSessionPanelWidth
} from "./domain/sessionPanelWidth";
import type { ImageSession, ImageSessionChatMessage } from "./types/image";
import { AppToolbar } from "./components/AppToolbar";
import { EmptyWorkspace } from "./components/EmptyWorkspace";
import { ImagePreviewDialog, type PreviewImage } from "./components/ImagePreviewDialog";
import { ImageWorkspace } from "./components/ImageWorkspace";
import { LogPanel } from "./components/LogPanel";
import { ProjectListDialog } from "./components/ProjectListDialog";
import { ProjectPlanPanel } from "./components/ProjectPlanPanel";
import { SessionPanel } from "./components/SessionPanel";
import type {
  AppLogEntry,
  ChatReferenceImage,
  EsseAgentHistoryMessage,
  EssePreflightRequest,
  EssePreflightResponse,
  ProjectListEntry,
  ProjectMetadata,
  ProjectSnapshot
} from "../electron/ipcTypes";
import type {
  BatchPlan,
  EsseImageRequest,
  EssePersona,
  ProjectManagerMessage,
  ProjectManagerState,
  WorkerCommand,
  WorkerReport
} from "./types/projectManager";
import esseTabMascot from "./assets/esse-tab-mascot.png";

const DEFAULT_COLUMNS = 4;
type SidebarTab = "project" | "image";
interface EsseDispatchTask {
  generationMode: "edit" | "generate";
  instruction: string;
  referenceImagePaths: string[];
  sessionId: string;
  sourceImagePath: string;
  outputSize?: string;
}

interface ChatImagePreview {
  images: PreviewImage[];
  initialPath: string;
  title: string;
}

export function App() {
  const [currentProject, setCurrentProject] = useState<ProjectMetadata | null>(null);
  const [sessions, setSessions] = useState<ImageSession[]>([]);
  const [projectManagerState, setProjectManagerState] = useState<ProjectManagerState>(() => createEmptyProjectManagerState());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>("image");
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [isCreatingProjectPlan, setIsCreatingProjectPlan] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const [chatImagePreview, setChatImagePreview] = useState<ChatImagePreview | null>(null);
  const [isProjectListOpen, setIsProjectListOpen] = useState(false);
  const [isProjectListLoading, setIsProjectListLoading] = useState(false);
  const [projectListEntries, setProjectListEntries] = useState<ProjectListEntry[]>([]);
  const [sessionPanelWidth, setSessionPanelWidth] = useState(() =>
    readStoredSessionPanelWidth(getBrowserStorage(), getViewportWidth())
  );
  const [isSessionPanelResizing, setIsSessionPanelResizing] = useState(false);
  const sessionsRef = useRef(sessions);
  const projectManagerStateRef = useRef(projectManagerState);
  const selectedSessionIdRef = useRef(selectedSessionId);
  const currentProjectRef = useRef(currentProject);
  const activeSessionOperationIdsRef = useRef(new Map<string, string>());
  const activeProjectOperationIdsRef = useRef(new Map<string, string>());
  const activeEsseOperationIdRef = useRef<string | null>(null);

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
  const projectManagerActivityLogs = useMemo(() => getProjectManagerActivityLogs(logs), [logs]);
  const recentProjects = useMemo(() => selectRecentProjects(projectListEntries), [projectListEntries]);
  const runningWorkCount = useMemo(
    () =>
      sessions.filter((session) => session.status === "generating" || session.status === "queued" || session.chatStatus === "sending").length +
      projectManagerState.plans.filter((plan) => plan.status === "running").length +
      (isCreatingProjectPlan ? 1 : 0),
    [isCreatingProjectPlan, projectManagerState.plans, sessions]
  );

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    projectManagerStateRef.current = projectManagerState;
  }, [projectManagerState]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    currentProjectRef.current = currentProject;
  }, [currentProject]);

  useEffect(() => {
    window.batchImager?.setRunningWorkCount(runningWorkCount);

    return () => {
      window.batchImager?.setRunningWorkCount(0);
    };
  }, [runningWorkCount]);

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
    void loadRecentProjects();
  }, []);

  useEffect(() => {
    const unsubscribe = window.batchImager?.subscribeProjectThumbnailUpdates(() => {
      if (isProjectListOpen || sessions.length === 0) {
        void loadProjectList();
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [isProjectListOpen, sessions.length]);

  useEffect(() => {
    const unsubscribe = window.batchImager?.subscribeProjectSnapshotUpdates((snapshot) => {
      applyProjectSnapshot(snapshot, { closePreviews: false });
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.batchImager?.subscribeEssePreflightRequests((request) => {
      const nextState = appendEssePreflightMessage(
        projectManagerStateRef.current,
        request,
        createMessageId("esse-preflight")
      );
      projectManagerStateRef.current = nextState;
      setProjectManagerState(nextState);
      persistProjectSnapshot(sessionsRef.current, selectedSessionIdRef.current, nextState);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

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

  function applyProjectSnapshot(snapshot: ProjectSnapshot, options: { closePreviews?: boolean } = {}): void {
    const nextSessions = snapshot.sessions as ImageSession[];
    const nextSelectedSessionId = getInitialSelectedSessionId(nextSessions, snapshot.selectedSessionId ?? null);

    setCurrentProject(snapshot.project);
    setSessions(nextSessions);
    setProjectManagerState(snapshot.projectManagerState ?? createEmptyProjectManagerState());
    setSelectedSessionId(nextSelectedSessionId);
    currentProjectRef.current = snapshot.project;
    sessionsRef.current = nextSessions;
    projectManagerStateRef.current = snapshot.projectManagerState ?? createEmptyProjectManagerState();
    selectedSessionIdRef.current = nextSelectedSessionId;
    if (options.closePreviews ?? true) {
      setPreviewSessionId(null);
      setChatImagePreview(null);
    }
    setIsProjectListOpen(false);
  }

  async function ensureProjectForImport(): Promise<ProjectSnapshot | null> {
    if (currentProject) {
      return null;
    }

    const snapshot = await window.batchImager?.createProject();
    if (snapshot) {
      applyProjectSnapshot(snapshot);
      void loadRecentProjects();
    }

    return snapshot ?? null;
  }

  function persistProjectSnapshot(
    nextSessions: ImageSession[],
    nextSelectedSessionId: string | null,
    nextProjectManagerState = projectManagerStateRef.current
  ): void {
    if (!currentProjectRef.current) {
      return;
    }

    void window.batchImager
      ?.saveProjectSnapshot({
        projectManagerState: nextProjectManagerState,
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

  function createOperationId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cancelOperation(operationId: string | null | undefined): void {
    if (!operationId) {
      return;
    }

    void window.batchImager?.cancelOperation({ operationId }).catch((error) => {
      console.error("[BatchImager UI] Operation cancel failed", error);
    });
  }

  function registerSessionOperation(sessionId: string, operationId: string): void {
    activeSessionOperationIdsRef.current.set(sessionId, operationId);
  }

  function isCurrentSessionOperation(sessionId: string, operationId: string): boolean {
    return activeSessionOperationIdsRef.current.get(sessionId) === operationId;
  }

  function unregisterSessionOperation(sessionId: string, operationId: string): void {
    if (isCurrentSessionOperation(sessionId, operationId)) {
      activeSessionOperationIdsRef.current.delete(sessionId);
    }
  }

  function registerProjectOperation(operationId: string, sessionId: string): void {
    activeProjectOperationIdsRef.current.set(operationId, sessionId);
  }

  function isCurrentProjectOperation(operationId: string): boolean {
    return activeProjectOperationIdsRef.current.has(operationId);
  }

  function unregisterProjectOperation(operationId: string): void {
    activeProjectOperationIdsRef.current.delete(operationId);
  }

  function isCanceledError(error: unknown): boolean {
    return error instanceof Error && /操作已停止|aborted|abort/i.test(error.message);
  }

  async function importImagePaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    await ensureProjectForImport();
    const snapshot = await window.batchImager?.importImages({ sourcePaths: paths });
    if (snapshot) {
      applyProjectSnapshot(snapshot);
      void loadRecentProjects();
    }
  }

  async function handleNewProject(): Promise<void> {
    const snapshot = await window.batchImager?.createProject();
    if (snapshot) {
      applyProjectSnapshot(snapshot);
      void loadRecentProjects();
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
      void loadRecentProjects();
    }
  }

  async function loadRecentProjects(): Promise<void> {
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
    await ensureProjectForImport();
    const snapshot = await window.batchImager?.importImages({ sourcePaths: [] });
    if (snapshot) {
      applyProjectSnapshot(snapshot);
      void loadRecentProjects();
    }
  }

  async function handleDrop(files: File[]): Promise<void> {
    const paths = files
      .map((file) => window.batchImager?.getPathForFile(file))
      .filter((path): path is string => Boolean(path));

    await importImagePaths(paths);
  }

  function handleSendChatMessage(
    sessionId: string,
    content: string,
    outputSize?: string,
    pastedReferenceImagePaths: string[] = []
  ): void {
    const session = sessions.find((currentSession) => currentSession.id === sessionId);

    if (session) {
      void sendChatMessage(session, content, outputSize, pastedReferenceImagePaths);
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

  function handleOpenChatImagePreview(title: string, images: PreviewImage[], initialPath: string): void {
    if (images.length === 0) {
      return;
    }

    setPreviewSessionId(null);
    setChatImagePreview({ images, initialPath, title });
  }

  function copyImageToClipboard(imagePath: string): void {
    void window.batchImager?.copyImageToClipboard({ imagePath }).catch((error) => {
      console.error("[BatchImager UI] Image copy failed", error);
    });
  }

  function deleteSession(sessionId: string): void {
    const result = removeImageSession(sessions, sessionId);
    setSessions(result.sessions);
    setSelectedSessionId(result.selectedSessionId);
    persistProjectSnapshot(result.sessions, result.selectedSessionId);

    if (previewSessionId === sessionId) {
      setPreviewSessionId(null);
    }
    setChatImagePreview(null);
  }

  function handleReorderSessions(sourceSessionId: string, targetSessionId: string): void {
    setSessions((currentSessions) => {
      const nextSessions = moveImageSession(currentSessions, sourceSessionId, targetSessionId);

      if (nextSessions === currentSessions) {
        return currentSessions;
      }

      return updateAndPersistSessions(nextSessions, selectedSessionIdRef.current);
    });
  }

  function handleRetrySession(sessionId: string): void {
    const session = sessionsRef.current.find((currentSession) => currentSession.id === sessionId);
    const retryRequest = session ? getSessionRetryRequest(session) : null;

    if (!session || !retryRequest) {
      return;
    }

    void generateForSession(
      session,
      retryRequest.prompt,
      retryRequest.referenceImagePaths,
      undefined,
      retryRequest.sourceImagePath
    );
  }

  function handleStopSessionWork(sessionId: string): void {
    cancelOperation(activeSessionOperationIdsRef.current.get(sessionId));
    activeSessionOperationIdsRef.current.delete(sessionId);
    for (const [operationId, projectSessionId] of activeProjectOperationIdsRef.current.entries()) {
      if (projectSessionId === sessionId) {
        cancelOperation(operationId);
        activeProjectOperationIdsRef.current.delete(operationId);
      }
    }

    setSessions((currentSessions) =>
      updateAndPersistSessions(stopSessionWork(currentSessions, sessionId), selectedSessionIdRef.current)
    );
  }

  function handleStopProjectWork(): void {
    cancelOperation(activeEsseOperationIdRef.current);
    activeEsseOperationIdRef.current = null;

    const affectedSessionIds = new Set<string>();
    for (const [operationId, sessionId] of activeProjectOperationIdsRef.current.entries()) {
      cancelOperation(operationId);
      affectedSessionIds.add(sessionId);
    }
    activeProjectOperationIdsRef.current.clear();

    setIsCreatingProjectPlan(false);
    const nextProjectManagerState = pauseRunningProjectPlans(projectManagerStateRef.current);
    projectManagerStateRef.current = nextProjectManagerState;
    setProjectManagerState(nextProjectManagerState);

    let nextSessions = sessionsRef.current;
    for (const sessionId of affectedSessionIds) {
      nextSessions = stopSessionWork(nextSessions, sessionId);
    }

    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    persistProjectSnapshot(nextSessions, selectedSessionIdRef.current, nextProjectManagerState);
  }

  async function handleSendEsseMessage(
    content: string,
    outputSize?: string,
    referenceImagePaths: string[] = [],
    persona?: EssePersona
  ): Promise<void> {
    await ensureProjectForImport();

    const currentSessions = sessionsRef.current;
    const userMessageId = createMessageId("esse-user");
    const resolvedReferences = resolveProjectManagerReferenceImages(
      projectManagerStateRef.current,
      content,
      referenceImagePaths
    );
    const nextState = createProjectManagerUserMessage(
      projectManagerStateRef.current,
      content,
      userMessageId,
      resolvedReferences.referenceImagePaths
    );

    setActiveSidebarTab("project");
    setProjectManagerState(nextState);
    projectManagerStateRef.current = nextState;
    persistProjectSnapshot(currentSessions, selectedSessionIdRef.current, nextState);

    if (resolvedReferences.errorMessage) {
      const errorState = appendProjectManagerError(nextState, resolvedReferences.errorMessage, createMessageId("esse-error"));
      setProjectManagerState(errorState);
      projectManagerStateRef.current = errorState;
      persistProjectSnapshot(currentSessions, selectedSessionIdRef.current, errorState);
      return;
    }

    setIsCreatingProjectPlan(true);
    const operationId = createOperationId("esse");
    activeEsseOperationIdRef.current = operationId;

    try {
      const history = [
        ...nextState.conversation.messages
          .filter(isEsseHistoryMessage)
          .map((message) => ({ role: message.role, content: message.content })),
      ];
      const result = await window.batchImager?.sendEsseMessage({
        messages: history,
        operationId,
        ...(outputSize ? { outputSize } : {}),
        ...(persona ? { persona } : {}),
        ...(resolvedReferences.referenceImagePaths.length ? { referenceImagePaths: resolvedReferences.referenceImagePaths } : {}),
        selectedSessionId: selectedSessionIdRef.current,
        sessions: currentSessions.map((session) => ({
          currentImagePath: getSessionGenerationSourcePath(session),
          fileName: session.fileName,
          ...(session.generatedFilePaths?.length ? { generatedFilePaths: session.generatedFilePaths } : {}),
          id: session.id
        }))
      });

      if (!result) {
        throw new Error("当前运行环境不支持 Esse 智能体");
      }
      if (activeEsseOperationIdRef.current !== operationId) {
        return;
      }

      let updatedState = appendProjectManagerAssistantMessage(
        projectManagerStateRef.current,
        result.reply,
        createMessageId("esse-assistant")
      );

      const nextSessions = sessionsRef.current;
      const nextSelectedSessionId = selectedSessionIdRef.current ?? nextSessions[0]?.id ?? null;

      setProjectManagerState(updatedState);
      setSessions(nextSessions);
      setSelectedSessionId(nextSelectedSessionId);
      projectManagerStateRef.current = updatedState;
      sessionsRef.current = nextSessions;
      selectedSessionIdRef.current = nextSelectedSessionId;
      persistProjectSnapshot(nextSessions, nextSelectedSessionId, updatedState);
    } catch (error) {
      if (activeEsseOperationIdRef.current !== operationId || isCanceledError(error)) {
        return;
      }
      const errorState = appendProjectManagerError(
        projectManagerStateRef.current,
        error instanceof Error ? error.message : "Esse 处理失败",
        createMessageId("esse-error")
      );
      setProjectManagerState(errorState);
      projectManagerStateRef.current = errorState;
      persistProjectSnapshot(sessionsRef.current, selectedSessionIdRef.current, errorState);
    } finally {
      if (activeEsseOperationIdRef.current === operationId) {
        activeEsseOperationIdRef.current = null;
        setIsCreatingProjectPlan(false);
      }
    }
  }

  function handleExecuteProjectPlan(planId: string, mode: ProjectPlanExecutionMode): void {
    const plan = projectManagerStateRef.current.plans.find((currentPlan) => currentPlan.id === planId);

    if (!plan || plan.status === "running") {
      return;
    }

    const commandsToRun = selectPlanCommandsForExecution(plan, mode);

    if (commandsToRun.length === 0) {
      return;
    }

    const runningState = markBatchPlanRunning(
      projectManagerStateRef.current,
      planId,
      mode === "failed" ? commandsToRun.map((command) => command.id) : undefined
    );
    const newImageCommands = commandsToRun.filter((command) => command.target === "new");
    setProjectManagerState(runningState);
    projectManagerStateRef.current = runningState;
    persistProjectSnapshot(sessions, selectedSessionId, runningState);

    for (const command of commandsToRun) {
      if (command.target === "new") {
        continue;
      }

      void executeProjectCommand(plan, command, runningState);
    }

    if (newImageCommands.length > 0) {
      void executeNewImagePlanCommands(plan, newImageCommands, runningState);
    }
  }

  async function handleResolveEssePreflight(requestId: string, decision: EssePreflightResponse["decision"]): Promise<void> {
    const result = await window.batchImager?.respondEssePreflight({ requestId, decision });
    if (!result?.accepted) {
      return;
    }

    const nextState = markEssePreflightDecision(projectManagerStateRef.current, requestId, decision);
    projectManagerStateRef.current = nextState;
    setProjectManagerState(nextState);
    persistProjectSnapshot(sessionsRef.current, selectedSessionIdRef.current, nextState);
  }

  function handleCancelEsseBatchTaskItem(batchTaskId: string, sessionId: string): void {
    void window.batchImager?.cancelEsseBatchTaskItem({ batchTaskId, sessionId }).catch((error) => {
      console.error("[BatchImager UI] Esse batch item cancel failed", error);
    });
  }

  function handleCancelEsseBatchTaskAll(batchTaskId: string): void {
    void window.batchImager?.cancelEsseBatchTaskAll({ batchTaskId }).catch((error) => {
      console.error("[BatchImager UI] Esse batch cancel failed", error);
    });
  }

  async function executeProjectCommand(
    plan: BatchPlan,
    command: WorkerCommand,
    baseProjectManagerState: ProjectManagerState
  ): Promise<void> {
    if (command.target === "new") {
      await executeNewImagePlanCommand(plan, command, baseProjectManagerState);
      return;
    }

    const session = sessionsRef.current.find((currentSession) => currentSession.id === command.targetSessionId);

    if (!session) {
      applyProjectCommandReport(plan.id, makeWorkerReport(command, "failed", undefined, "图片不存在"), baseProjectManagerState);
      return;
    }

    const sourcePath = getSessionGenerationSourcePath(session);
    const referenceImages = getCommandReferenceImages(plan, command);
    const referenceImagePaths = referenceImages.map((referenceImage) => referenceImage.filePath);
    const operationId = createOperationId("project-command");
    registerProjectOperation(operationId, command.targetSessionId);

    setSessions((currentSessions) =>
      updateAndPersistSessions(
        markSessionProjectCommand(
          currentSessions,
          command.targetSessionId,
          {
            instruction: command.instruction,
            referenceFilePaths: referenceImagePaths,
            sourceFilePath: sourcePath
          },
          createMessageId("project-command")
        ),
          selectedSessionIdRef.current,
          baseProjectManagerState
      )
    );

    try {
      const result = await window.batchImager?.sendChatMessage({
        context: {
          currentImageLabel: session.generatedFilePath ? "最近生成图" : "初始导入图",
          fileName: session.fileName,
          originalImageLabel: "初始导入图",
          ...(referenceImagePaths.length ? { referenceImageCount: referenceImagePaths.length } : {})
        },
        operationId,
        imagePath: sourcePath,
        messages: [{ role: "user", content: command.instruction }],
        ...(command.outputSize ? { outputSize: command.outputSize } : {}),
        ...(referenceImages.length ? { referenceImages } : {}),
        sessionId: command.targetSessionId
      });

      if (!result) {
        throw new Error("当前运行环境不支持会话");
      }
      if (!isCurrentProjectOperation(operationId)) {
        return;
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
            createMessageId("assistant")
          ),
          selectedSessionIdRef.current
        )
      );
      applyProjectCommandReport(
        plan.id,
        makeWorkerReport(command, "completed", result.generatedImagePath, "已完成生成。"),
        baseProjectManagerState
      );
    } catch (error) {
      if (!isCurrentProjectOperation(operationId) || isCanceledError(error)) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applySessionChatError(currentSessions, command.targetSessionId, errorMessage, createMessageId("error")),
          selectedSessionIdRef.current
        )
      );
      applyProjectCommandReport(plan.id, makeWorkerReport(command, "failed", undefined, errorMessage), baseProjectManagerState);
    } finally {
      unregisterProjectOperation(operationId);
    }
  }

  async function executeNewImagePlanCommand(
    plan: BatchPlan,
    command: WorkerCommand,
    baseProjectManagerState: ProjectManagerState
  ): Promise<void> {
    await executeNewImagePlanCommands(plan, [command], baseProjectManagerState);
  }

  async function executeNewImagePlanCommands(
    plan: BatchPlan,
    commands: WorkerCommand[],
    baseProjectManagerState: ProjectManagerState
  ): Promise<void> {
    const preparedTasks: Array<{ command: WorkerCommand; task: EsseDispatchTask }> = [];
    let nextSessions = sessionsRef.current;

    for (const command of commands) {
      const referenceImages = getCommandReferenceImages(plan, command);
      const referenceImagePaths = referenceImages.map((referenceImage) => referenceImage.filePath);
      const imageRequest: EsseImageRequest = {
        id: command.id,
        mode: command.generationMode ?? (command.sourceSessionId ? "edit" : "generate"),
        prompt: command.instruction,
        ...(command.outputSize ? { size: command.outputSize } : {}),
        ...(command.sourceSessionId ? { sourceSessionId: command.sourceSessionId } : {}),
        target: "new"
      };

      try {
        const prepared = await prepareEsseImageTasks(nextSessions, [imageRequest], referenceImagePaths);
        const task = prepared.dispatchTasks[0];

        if (!task) {
          throw new Error("没有可执行的新图任务");
        }

        nextSessions = prepared.nextSessions;
        preparedTasks.push({ command, task });
      } catch (error) {
        applyProjectCommandReport(
          plan.id,
          makeWorkerReport(command, "failed", undefined, error instanceof Error ? error.message : "未知错误"),
          baseProjectManagerState
        );
      }
    }

    if (preparedTasks.length === 0) {
      return;
    }

    const nextSelectedSessionId = selectedSessionIdRef.current ?? nextSessions[0]?.id ?? null;
    setSessions(nextSessions);
    setSelectedSessionId(nextSelectedSessionId);
    sessionsRef.current = nextSessions;
    selectedSessionIdRef.current = nextSelectedSessionId;
    persistProjectSnapshot(nextSessions, nextSelectedSessionId, baseProjectManagerState);

    await Promise.all(
      preparedTasks.map(async ({ command, task }) => {
        try {
          const generatedImagePath = await runEsseImageTask(task);
          applyProjectCommandReport(
            plan.id,
            makeWorkerReport(command, "completed", generatedImagePath, "已完成生成。"),
            baseProjectManagerState
          );
        } catch (error) {
          if (isCanceledError(error)) {
            return;
          }
          applyProjectCommandReport(
            plan.id,
            makeWorkerReport(command, "failed", undefined, error instanceof Error ? error.message : "未知错误"),
            baseProjectManagerState
          );
        }
      })
    );
  }

  function applyProjectCommandReport(
    planId: string,
    report: WorkerReport,
    fallbackState: ProjectManagerState = projectManagerStateRef.current
  ): void {
    setProjectManagerState((currentState) => {
      const sourceState = currentState.plans.some((plan) => plan.id === planId) ? currentState : fallbackState;
      const nextState = applyWorkerReport(sourceState, planId, report);
      persistProjectSnapshot(sessionsRef.current, selectedSessionIdRef.current, nextState);
      projectManagerStateRef.current = nextState;
      return nextState;
    });
  }

  async function prepareEsseImageTasks(
    currentSessions: ImageSession[],
    imageRequests: EsseImageRequest[],
    promptReferenceImagePaths: string[] = []
  ): Promise<{ dispatchTasks: EsseDispatchTask[]; nextSessions: ImageSession[] }> {
    if (imageRequests.length === 0) {
      return { dispatchTasks: [], nextSessions: currentSessions };
    }

    const nextSessions = [...currentSessions];
    const dispatchTasks: EsseDispatchTask[] = [];

    for (const imageRequest of imageRequests) {
      const sourceSession = imageRequest.sourceSessionId
        ? nextSessions.find((session) => session.id === imageRequest.sourceSessionId)
        : undefined;
      const sourceImagePath = sourceSession ? getSessionGenerationSourcePath(sourceSession) : "";

      if (imageRequest.target === "existing" && sourceSession) {
        dispatchTasks.push({
          generationMode: "edit",
          instruction: imageRequest.prompt,
          ...(imageRequest.size ? { outputSize: imageRequest.size } : {}),
          referenceImagePaths: promptReferenceImagePaths,
          sessionId: sourceSession.id,
          sourceImagePath
        });
        continue;
      }

      const placeholderSessionId = createNextImageSessionId(nextSessions);
      const placeholder = await window.batchImager?.createPlaceholderImage({
        sessionId: placeholderSessionId,
        ...(imageRequest.size ? { size: imageRequest.size } : {})
      });

      if (!placeholder) {
        throw new Error("当前运行环境不支持创建图片占位");
      }

      nextSessions.push({
        chatMessages: [],
        chatStatus: "idle",
        fileName: getFileName(placeholder.filePath),
        filePath: placeholder.filePath,
        generationMode: imageRequest.mode,
        id: placeholderSessionId,
        status: "queued"
      });
      dispatchTasks.push({
        generationMode: imageRequest.mode,
        instruction: imageRequest.prompt,
        ...(imageRequest.size ? { outputSize: imageRequest.size } : {}),
        referenceImagePaths: promptReferenceImagePaths,
        sessionId: placeholderSessionId,
        sourceImagePath: imageRequest.mode === "edit" ? sourceImagePath : placeholder.filePath
      });
    }

    return { dispatchTasks, nextSessions };
  }

  async function runEsseImageTask(task: EsseDispatchTask): Promise<string | undefined> {
    const session = sessionsRef.current.find((currentSession) => currentSession.id === task.sessionId);

    if (!session) {
      throw new Error("图片不存在");
    }
    const operationId = createOperationId("esse-image");
    registerProjectOperation(operationId, task.sessionId);

    setSessions((currentSessions) =>
      updateAndPersistSessions(
        markSessionEsseTask(
          currentSessions,
          task.sessionId,
          {
            instruction: task.instruction,
            referenceFilePaths: task.referenceImagePaths,
            ...(task.generationMode === "edit" ? { sourceFilePath: task.sourceImagePath } : {})
          },
          createMessageId("esse-task")
        ),
        selectedSessionIdRef.current
      )
    );

    try {
      const result = await window.batchImager?.sendChatMessage({
        context: {
          currentImageLabel: task.generationMode === "generate" ? "空白占位图" : "源图片",
          fileName: session.fileName,
          originalImageLabel: "初始图"
        },
        generationMode: task.generationMode,
        imagePath: task.sourceImagePath,
        messages: [{ role: "user", content: task.instruction }],
        operationId,
        ...(task.outputSize ? { outputSize: task.outputSize } : {}),
        ...(task.referenceImagePaths.length
          ? {
              referenceImages: task.referenceImagePaths.map((filePath, index) => ({
                filePath,
                id: `prompt-ref-${index + 1}`,
                label: `Esse 提示图 ${index + 1}：${getFileName(filePath)}`
              }))
            }
          : {}),
        sessionId: task.sessionId
      });

      if (!result) {
        throw new Error("当前运行环境不支持会话");
      }
      if (!isCurrentProjectOperation(operationId)) {
        throw new Error("操作已停止");
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
            createMessageId("assistant")
          ),
          selectedSessionIdRef.current
        )
      );
      return result.generatedImagePath;
    } catch (error) {
      if (!isCurrentProjectOperation(operationId)) {
        throw new Error("操作已停止");
      }
      if (isCanceledError(error)) {
        throw error;
      }
      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applySessionChatError(
            currentSessions,
            task.sessionId,
            error instanceof Error ? error.message : "未知错误",
            createMessageId("error")
          ),
          selectedSessionIdRef.current
        )
      );
      throw error;
    } finally {
      unregisterProjectOperation(operationId);
    }
  }

  async function generateForSession(
    session: ImageSession,
    prompt: string,
    referenceImagePaths: string[] = [],
    outputSize?: string,
    sourceImagePath?: string
  ): Promise<void> {
    const sourcePath = sourceImagePath ?? getSessionGenerationSourcePath(session);
    const operationId = createOperationId("image");
    registerSessionOperation(session.id, operationId);
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
        operationId,
        prompt,
        ...(referenceImagePaths.length ? { referenceImagePaths } : {}),
        ...(outputSize ? { size: outputSize } : {}),
        sessionId: session.id
      });

      if (!result) {
        throw new Error("当前运行环境不支持图像生成");
      }
      if (!isCurrentSessionOperation(session.id, operationId)) {
        return;
      }

      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applyGeneratedImageResult(currentSessions, result.sessionId, result.outputPath, createMessageId("image")),
          selectedSessionId
        )
      );
      console.info("[BatchImager UI] Image generation completed", { outputPath: result.outputPath, sessionId: session.id });
    } catch (error) {
      if (!isCurrentSessionOperation(session.id, operationId) || isCanceledError(error)) {
        return;
      }
      console.error("[BatchImager UI] Image generation failed", error);
      setSessions((currentSessions) =>
        updateAndPersistSessions(
          applySessionGenerationError(currentSessions, session.id, error instanceof Error ? error.message : "未知错误"),
          selectedSessionId
        )
      );
    } finally {
      unregisterSessionOperation(session.id, operationId);
    }
  }

  async function sendChatMessage(
    session: ImageSession,
    content: string,
    outputSize?: string,
    pastedReferenceImagePaths: string[] = []
  ): Promise<void> {
    const sourcePath = getSessionGenerationSourcePath(session);
    const userMessageId = createMessageId("user");
    const assistantMessageId = createMessageId("assistant");
    const history = [
      ...session.chatMessages
        .filter(isChatHistoryMessage)
        .map((message) => ({ role: message.role, content: message.content })),
      { role: "user" as const, content }
    ];
    const referenceImages = getSessionReferenceImages(session, pastedReferenceImagePaths);
    const referenceImagePaths = referenceImages.map((referenceImage) => referenceImage.filePath);
    const operationId = createOperationId("chat");
    registerSessionOperation(session.id, operationId);

    setSessions((currentSessions) =>
      updateAndPersistSessions(
        addSessionUserMessage(currentSessions, session.id, content, userMessageId, pastedReferenceImagePaths),
        selectedSessionId
      )
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
        operationId,
        ...(outputSize ? { outputSize } : {}),
        ...(referenceImages.length ? { referenceImages } : {}),
        sessionId: session.id
      });

      if (!result) {
        throw new Error("当前运行环境不支持会话");
      }
      if (!isCurrentSessionOperation(session.id, operationId)) {
        return;
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
      if (!isCurrentSessionOperation(session.id, operationId) || isCanceledError(error)) {
        return;
      }
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
    } finally {
      unregisterSessionOperation(session.id, operationId);
    }
  }

  function updateAndPersistSessions(
    nextSessions: ImageSession[],
    nextSelectedSessionId: string | null,
    nextProjectManagerState = projectManagerStateRef.current
  ): ImageSession[] {
    sessionsRef.current = nextSessions;
    selectedSessionIdRef.current = nextSelectedSessionId;
    projectManagerStateRef.current = nextProjectManagerState;
    persistProjectSnapshot(nextSessions, nextSelectedSessionId, nextProjectManagerState);
    return nextSessions;
  }

  function persistSessionPanelWidth(width: number): number {
    const nextWidth = saveStoredSessionPanelWidth(getBrowserStorage(), width, getViewportWidth());
    setSessionPanelWidth(nextWidth);
    return nextWidth;
  }

  function handleSessionPanelResizePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsSessionPanelResizing(true);

    const startX = event.clientX;
    const startWidth = sessionPanelWidth;
    let latestWidth = startWidth;

    function handlePointerMove(moveEvent: globalThis.PointerEvent): void {
      latestWidth = clampSessionPanelWidth(startWidth + startX - moveEvent.clientX, getViewportWidth());
      setSessionPanelWidth(latestWidth);
    }

    function handlePointerUp(): void {
      persistSessionPanelWidth(latestWidth);
      setIsSessionPanelResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function handleSessionPanelResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 48 : 16;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      persistSessionPanelWidth(sessionPanelWidth + step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      persistSessionPanelWidth(sessionPanelWidth - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      persistSessionPanelWidth(0);
    } else if (event.key === "End") {
      event.preventDefault();
      persistSessionPanelWidth(Number.POSITIVE_INFINITY);
    }
  }

  return (
    <div
      className={`app-shell ${isSessionPanelResizing ? "resizing-session" : ""}`}
      style={{ "--session-panel-width": `${sessionPanelWidth}px` } as CSSProperties}
    >
      <AppToolbar
        columns={columns}
        logCount={logs.length}
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
              isRecentProjectsLoading={isProjectListLoading}
              recentProjects={recentProjects}
              onImport={handleSelectImages}
              onDropFiles={handleDrop}
              onDraggingChange={setIsDragging}
              onOpenProject={(directory) => {
                void handleOpenProjectFromList(directory);
              }}
            />
          ) : (
            <ImageWorkspace
              columns={columns}
              isDragging={isDragging}
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              onDeleteSession={deleteSession}
              onDropFiles={handleDrop}
              onDraggingChange={setIsDragging}
              onOpenPreview={setPreviewSessionId}
              onRetrySession={handleRetrySession}
              onReorderSessions={handleReorderSessions}
              onSelectSession={(sessionId) => {
                setSelectedSessionId(sessionId);
                setActiveSidebarTab("image");
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

        <div
          className="session-resize-handle"
          role="separator"
          aria-label="调整会话栏宽度"
          aria-orientation="vertical"
          aria-valuenow={sessionPanelWidth}
          tabIndex={0}
          onDoubleClick={() => persistSessionPanelWidth(DEFAULT_SESSION_PANEL_WIDTH)}
          onKeyDown={handleSessionPanelResizeKeyDown}
          onPointerDown={handleSessionPanelResizePointerDown}
        />

        <aside className="session-panel" aria-label="右侧工作栏">
          <div className="sidebar-tabs" role="tablist" aria-label="工作对象">
            <button
              className={`sidebar-tab-button sidebar-tab-button-esse ${activeSidebarTab === "project" ? "active" : ""}`}
              role="tab"
              type="button"
              aria-selected={activeSidebarTab === "project"}
              onClick={() => setActiveSidebarTab("project")}
            >
              <img className="sidebar-tab-mascot" src={esseTabMascot} alt="" aria-hidden="true" draggable={false} />
              <span className="sidebar-tab-label">Esse</span>
              {projectManagerState.plans.some((plan) => plan.status === "running") ? <span className="tab-dot running" /> : null}
            </button>
            <button
              className={`sidebar-tab-button sidebar-tab-button-current ${activeSidebarTab === "image" ? "active" : ""}`}
              role="tab"
              type="button"
              aria-selected={activeSidebarTab === "image"}
              onClick={() => setActiveSidebarTab("image")}
            >
              <span className="sidebar-tab-label">当前图片</span>
              {selectedSession?.status === "generating" ? <span className="tab-dot running" /> : null}
              {selectedSession?.status === "failed" ? <span className="tab-dot failed" /> : null}
            </button>
          </div>
          {activeSidebarTab === "project" ? (
            <ProjectPlanPanel
              activityLogs={projectManagerActivityLogs}
              imageSessions={sessions}
              isCreatingPlan={isCreatingProjectPlan}
              projectManagerState={projectManagerState}
              onExecutePlan={handleExecuteProjectPlan}
              onCopyImage={copyImageToClipboard}
              onCancelBatchTaskAll={handleCancelEsseBatchTaskAll}
              onCancelBatchTaskItem={handleCancelEsseBatchTaskItem}
              onOpenImagePreview={handleOpenChatImagePreview}
              onResolvePreflight={(requestId, decision) => {
                void handleResolveEssePreflight(requestId, decision);
              }}
              onSendMessage={(content, outputSize, referenceImagePaths, persona) => {
                void handleSendEsseMessage(content, outputSize, referenceImagePaths, persona);
              }}
              onStopWork={handleStopProjectWork}
            />
          ) : (
            <SessionPanel
              activityLogs={selectedSessionActivityLogs}
              selectedSession={selectedSession}
              onCopyImage={copyImageToClipboard}
              onOpenImagePreview={handleOpenChatImagePreview}
              onSendMessage={handleSendChatMessage}
              onStopWork={handleStopSessionWork}
            />
          )}
        </aside>
      </main>

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
          currentImagePath={getSessionGenerationSourcePath(previewSession)}
          images={buildSessionPreviewImages(previewSession)}
          initialPath={getSessionGenerationSourcePath(previewSession)}
          title={previewSession.fileName}
          onClose={() => setPreviewSessionId(null)}
          onCopyImage={copyImageToClipboard}
          onUseImage={(imagePath) => handleUsePreviewImage(previewSession.id, imagePath)}
        />
      ) : null}
      {chatImagePreview ? (
        <ImagePreviewDialog
          images={chatImagePreview.images}
          initialPath={chatImagePreview.initialPath}
          title={chatImagePreview.title}
          onClose={() => setChatImagePreview(null)}
          onCopyImage={copyImageToClipboard}
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

function isEsseHistoryMessage(message: ProjectManagerMessage): message is ProjectManagerMessage & EsseAgentHistoryMessage {
  return message.role === "user" || message.role === "assistant";
}

function getSessionRetryRequest(
  session: ImageSession
): { prompt: string; referenceImagePaths: string[]; sourceImagePath: string } | null {
  const prompt = session.lastPrompt?.trim();
  if (!prompt) {
    return null;
  }

  const generationContext = [...session.chatMessages]
    .reverse()
    .find((message) => message.contextType === "batch-prompt" || message.contextType === "project-command" || message.contextType === "esse-task");

  return {
    prompt,
    referenceImagePaths: generationContext?.referenceFilePaths ?? [],
    sourceImagePath: generationContext?.sourceFilePath ?? getSessionGenerationSourcePath(session)
  };
}

function getSessionReferenceImages(session: ImageSession, pastedReferenceImagePaths: string[] = []): ChatReferenceImage[] {
  const paths = new Set<string>();

  for (const message of session.chatMessages) {
    for (const referenceFilePath of message.referenceFilePaths ?? []) {
      paths.add(referenceFilePath);
    }
  }

  for (const pastedReferenceImagePath of pastedReferenceImagePaths) {
    paths.add(pastedReferenceImagePath);
  }

  return [...paths].map((filePath, index) => ({
    filePath,
    id: `ref-${index + 1}`,
    label: `参考图 ${index + 1}：${getFileName(filePath)}`
  }));
}

function buildSessionPreviewImages(session: ImageSession): PreviewImage[] {
  const generatedPaths = (session.generatedFilePaths ?? (session.generatedFilePath ? [session.generatedFilePath] : [])).filter(
    (path) => path !== session.filePath
  );

  return [
    {
      key: `original-${session.filePath}`,
      label: "原图",
      path: session.filePath
    },
    ...generatedPaths.map((path, index) => ({
      key: `generated-${path}`,
      label: `记录 ${index + 1}`,
      path
    }))
  ];
}

function getCommandReferenceImages(plan: BatchPlan, command: WorkerCommand): ChatReferenceImage[] {
  if (!command.referenceImageIds?.length || !plan.referenceImages?.length) {
    return [];
  }

  const byId = new Map(plan.referenceImages.map((referenceImage) => [referenceImage.id, referenceImage]));

  return command.referenceImageIds
    .map((id) => byId.get(id))
    .filter((referenceImage): referenceImage is NonNullable<typeof referenceImage> => Boolean(referenceImage))
    .map((referenceImage) => ({
      filePath: referenceImage.filePath,
      id: referenceImage.id,
      label: referenceImage.label
    }));
}

function makeWorkerReport(
  command: WorkerCommand,
  status: WorkerReport["status"],
  generatedImagePath: string | undefined,
  summary: string
): WorkerReport {
  return {
    commandId: command.id,
    ...(generatedImagePath ? { generatedImagePath } : {}),
    ...(status === "failed" ? { errorMessage: summary } : {}),
    status,
    summary,
    targetSessionId: command.targetSessionId
  };
}

function appendProjectManagerError(state: ProjectManagerState, content: string, messageId: string): ProjectManagerState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [
        ...state.conversation.messages,
        {
          content,
          id: messageId,
          role: "error"
        }
      ]
    }
  };
}

function appendEssePreflightMessage(
  state: ProjectManagerState,
  request: EssePreflightRequest,
  messageId: string
): ProjectManagerState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [
        ...state.conversation.messages,
        {
          content: "",
          id: messageId,
          preflightDecision: "pending",
          preflightRequest: request,
          role: "context"
        }
      ]
    }
  };
}

function markEssePreflightDecision(
  state: ProjectManagerState,
  requestId: string,
  decision: Exclude<ProjectManagerMessage["preflightDecision"], "pending" | undefined>
): ProjectManagerState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: state.conversation.messages.map((message) =>
        message.preflightRequest?.requestId === requestId
          ? {
              ...message,
              preflightDecision: decision
            }
          : message
      )
    }
  };
}


function createNextImageSessionId(sessions: ImageSession[]): string {
  const used = new Set(sessions.map((session) => session.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = createImageSessionId();

    if (!used.has(id)) {
      return id;
    }
  }

  let index = sessions.length + 1;
  let fallbackId = `sess_fallback_${index}`;
  while (used.has(fallbackId)) {
    index += 1;
    fallbackId = `sess_fallback_${index}`;
  }

  return fallbackId;
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

function getBrowserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getViewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}
