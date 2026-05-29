import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi, type Mock } from "vitest";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResponseAck,
  AgentProviderDescriptor,
  AgentPreflightRequest,
  AgentPreflightResponse,
  AgentPreflightResponseAck,
  AgentAssistantMessageUpdateEvent,
  AgentBashExecutionEvent,
  AppLogEntry,
  ChatImageGenerationStartedEvent,
  EsseAssistantMessageUpdateEvent,
  EsseBashExecutionEvent,
  EssePermissionRequest,
  EssePermissionResponse,
  EssePermissionResponseAck,
  EssePreflightRequest,
  EssePreflightResponse,
  EssePreflightResponseAck,
  ProjectListEntry,
  ProjectSnapshot,
  SaveProjectSnapshotRequest,
  SendAgentMessageRequest,
  SendAgentMessageResponse,
  SendChatMessageRequest,
  SendChatMessageResponse
} from "../../electron/ipcTypes";
import type { BatchImagerApi } from "../../electron/preload";

type Listener<T> = (event: T) => void;

export interface BatchImagerAppE2eHarness {
  api: BatchImagerApi;
  emitAssistantMessageUpdate: (event: AgentAssistantMessageUpdateEvent) => void;
  emitBashExecution: (event: AgentBashExecutionEvent) => void;
  emitChatImageGenerationStarted: (event: ChatImageGenerationStartedEvent) => void;
  emitPermissionRequest: (request: AgentPermissionRequest) => void;
  emitPreflightRequest: (request: AgentPreflightRequest) => void;
  emitProjectSnapshotUpdate: (snapshot: ProjectSnapshot) => void;
  getSnapshot: () => ProjectSnapshot;
  mocks: {
    createProject: Mock<() => Promise<ProjectSnapshot>>;
    importImages: Mock<BatchImagerApi["importImages"]>;
    listAgentProviders: Mock<() => Promise<AgentProviderDescriptor[]>>;
    respondAgentPermission: Mock<(response: AgentPermissionResponse) => Promise<AgentPermissionResponseAck>>;
    respondAgentPreflight: Mock<(response: AgentPreflightResponse) => Promise<AgentPreflightResponseAck>>;
    respondEssePermission: Mock<(response: EssePermissionResponse) => Promise<EssePermissionResponseAck>>;
    respondEssePreflight: Mock<(response: EssePreflightResponse) => Promise<EssePreflightResponseAck>>;
    saveProjectSnapshot: Mock<(request: SaveProjectSnapshotRequest) => Promise<ProjectSnapshot>>;
    sendAgentMessage: Mock<(request: SendAgentMessageRequest) => Promise<SendAgentMessageResponse>>;
    sendChatMessage: Mock<(request: SendChatMessageRequest) => Promise<SendChatMessageResponse>>;
    setRunningWorkCount: Mock<(count: number) => void>;
  };
  renderResult: RenderResult;
  setSnapshot: (snapshot: ProjectSnapshot) => void;
}

export interface BatchImagerAppE2eOptions {
  agentProviders?: AgentProviderDescriptor[];
  initialSnapshot: ProjectSnapshot;
  logs?: AppLogEntry[];
  onRespondAgentPermission?: (
    response: AgentPermissionResponse,
    harness: BatchImagerAppE2eHarness
  ) => Promise<AgentPermissionResponseAck> | AgentPermissionResponseAck;
  onRespondAgentPreflight?: (
    response: AgentPreflightResponse,
    harness: BatchImagerAppE2eHarness
  ) => Promise<AgentPreflightResponseAck> | AgentPreflightResponseAck;
  onRespondEssePermission?: (
    response: EssePermissionResponse,
    harness: BatchImagerAppE2eHarness
  ) => Promise<EssePermissionResponseAck> | EssePermissionResponseAck;
  onRespondEssePreflight?: (
    response: EssePreflightResponse,
    harness: BatchImagerAppE2eHarness
  ) => Promise<EssePreflightResponseAck> | EssePreflightResponseAck;
  onSendAgentMessage?: (
    request: SendAgentMessageRequest,
    harness: BatchImagerAppE2eHarness
  ) => Promise<SendAgentMessageResponse> | SendAgentMessageResponse;
  onSendChatMessage?: (
    request: SendChatMessageRequest,
    harness: BatchImagerAppE2eHarness
  ) => Promise<SendChatMessageResponse> | SendChatMessageResponse;
  projects?: ProjectListEntry[];
}

const DEFAULT_AGENT_PROVIDER: AgentProviderDescriptor = {
  description: "BatchImager 当前内置的图片工作台协作 agent。",
  id: "esse",
  label: "Esse",
  shortLabel: "Esse",
  status: "available",
  supportsPersona: true,
  workbenchCapabilityIds: [
    "get_project_overview",
    "list_sessions",
    "get_session_records",
    "read_image_metadata",
    "list_reference_images",
    "list_remembered_preferences",
    "scan_unreferenced_files"
  ]
};

export function renderBatchImagerAppE2e(
  ui: ReactElement,
  options: BatchImagerAppE2eOptions
): BatchImagerAppE2eHarness {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn()
    }
  });

  let snapshot = options.initialSnapshot;
  const preflightListeners = new Set<Listener<AgentPreflightRequest>>();
  const permissionListeners = new Set<Listener<AgentPermissionRequest>>();
  const snapshotListeners = new Set<Listener<ProjectSnapshot>>();
  const assistantUpdateListeners = new Set<Listener<AgentAssistantMessageUpdateEvent>>();
  const bashExecutionListeners = new Set<Listener<AgentBashExecutionEvent>>();
  const chatGenerationStartedListeners = new Set<Listener<ChatImageGenerationStartedEvent>>();
  const logListeners = new Set<Listener<AppLogEntry>>();
  let harness: BatchImagerAppE2eHarness;

  const createProject = vi.fn(async () => emptyProjectSnapshot(snapshot));
  const importImages = vi.fn(async () => snapshot);
  const saveProjectSnapshot = vi.fn(async (request: SaveProjectSnapshotRequest) => {
    snapshot = mergeSnapshot(snapshot, request);
    return snapshot;
  });
  const setRunningWorkCount = vi.fn();
  const listAgentProviders = vi.fn(async () => options.agentProviders ?? [DEFAULT_AGENT_PROVIDER]);
  const sendAgentMessage = vi.fn((request: SendAgentMessageRequest): Promise<SendAgentMessageResponse> =>
    Promise.resolve(options.onSendAgentMessage?.(request, harness) ?? {
      providerId: request.providerId,
      reply: ""
    })
  );
  const sendChatMessage = vi.fn((request: SendChatMessageRequest): Promise<SendChatMessageResponse> =>
    Promise.resolve(options.onSendChatMessage?.(request, harness) ?? {
      assistantMessage: "已完成。",
      sessionId: request.sessionId
    })
  );
  const respondAgentPreflight = vi.fn((response: AgentPreflightResponse): Promise<AgentPreflightResponseAck> =>
    Promise.resolve(options.onRespondAgentPreflight?.(response, harness) ?? options.onRespondEssePreflight?.(response, harness) ?? { accepted: true })
  );
  const respondAgentPermission = vi.fn((response: AgentPermissionResponse): Promise<AgentPermissionResponseAck> =>
    Promise.resolve(options.onRespondAgentPermission?.(response, harness) ?? options.onRespondEssePermission?.(response, harness) ?? { accepted: true })
  );
  const respondEssePreflight = vi.fn((response: EssePreflightResponse): Promise<EssePreflightResponseAck> =>
    respondAgentPreflight(response)
  );
  const respondEssePermission = vi.fn((response: EssePermissionResponse): Promise<EssePermissionResponseAck> =>
    respondAgentPermission(response)
  );

  const api: BatchImagerApi = {
    addEsseMemory: vi.fn(async () => ({ snapshot: emptyEsseMemorySnapshot() })),
    addEsseSkillPath: vi.fn(async () => emptyEsseSkillsSnapshot()),
    cancelAgentBatchTaskAll: vi.fn(async () => ({ canceledCount: 0 })),
    cancelAgentBatchTaskItem: vi.fn(async () => ({ canceled: false })),
    cancelEsseBatchTaskAll: vi.fn(async () => ({ canceledCount: 0 })),
    cancelEsseBatchTaskItem: vi.fn(async () => ({ canceled: false })),
    cancelOperation: vi.fn(async () => ({ canceled: true })),
    copyImageToClipboard: vi.fn(async () => ({ ok: true as const })),
    createPlaceholderImage: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      filePath: `${snapshot.project.directory}/images/generated/${sessionId}-placeholder.png`
    })),
    createProject,
    deleteProject: vi.fn(async () => options.projects ?? []),
    exportImages: vi.fn(async () => ({ outputPath: `${snapshot.project.directory}/export.zip` })),
    generateImage: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      outputPath: `${snapshot.project.directory}/images/generated/${sessionId}.png`,
      sessionId
    })),
    getApiSettings: vi.fn(async () => emptyApiSettingsSnapshot()),
    getImageUrl: (filePath: string) => `batchimager-test://${encodeURIComponent(filePath)}`,
    getLogs: vi.fn(async () => options.logs ?? []),
    getPathForFile: (file: File) => file.name,
    importImages,
    installEsseSkillFromGit: vi.fn(async () => emptyEsseSkillsSnapshot()),
    listAgentProviders,
    listEsseMemories: vi.fn(async () => emptyEsseMemorySnapshot()),
    listEsseSkills: vi.fn(async () => emptyEsseSkillsSnapshot()),
    listProjects: vi.fn(async () => options.projects ?? []),
    openProject: vi.fn(async () => snapshot),
    platform: process.platform,
    readEsseSkillFile: vi.fn(async () => ({ content: "", filePath: "" })),
    reloadEsseSkills: vi.fn(async () => emptyEsseSkillsSnapshot()),
    rememberProjectDirectory: vi.fn(async () => options.projects ?? []),
    removeEsseMemory: vi.fn(async () => emptyEsseMemorySnapshot()),
    removeEsseSkill: vi.fn(async () => emptyEsseSkillsSnapshot()),
    renameProject: vi.fn(async () => options.projects ?? []),
    respondAgentPermission,
    respondAgentPreflight,
    respondEssePermission,
    respondEssePreflight,
    retryAgentBatchTaskFailed: vi.fn(async () => ({ acceptedCount: 0, rejected: [] })),
    retryAgentBatchTaskItem: vi.fn(async () => ({ accepted: false, reason: "not configured" })),
    retryEsseBatchTaskFailed: vi.fn(async () => ({ acceptedCount: 0, rejected: [] })),
    retryEsseBatchTaskItem: vi.fn(async () => ({ accepted: false, reason: "not configured" })),
    saveApiSettings: vi.fn(async () => emptyApiSettingsSnapshot()),
    saveProjectSnapshot,
    saveReferenceImage: vi.fn(async () => ({
      fileName: "reference.png",
      filePath: `${snapshot.project.directory}/references/reference.png`
    })),
    sendAgentMessage,
    sendChatMessage,
    sendEsseMessage: vi.fn(async () => ({ reply: "" })),
    setEsseSkillEnabled: vi.fn(async () => emptyEsseSkillsSnapshot()),
    setRunningWorkCount,
    showFileInFolder: vi.fn(async () => ({ ok: true as const })),
    subscribeAgentAssistantMessageUpdates: subscribe(assistantUpdateListeners),
    subscribeAgentBashExecutionEvents: subscribe(bashExecutionListeners),
    subscribeChatImageGenerationStarted: subscribe(chatGenerationStartedListeners),
    subscribeEsseAssistantMessageUpdates: subscribe(assistantUpdateListeners),
    subscribeEsseBashExecutionEvents: subscribe(bashExecutionListeners),
    subscribeAgentPermissionRequests: subscribe(permissionListeners),
    subscribeAgentPreflightRequests: subscribe(preflightListeners),
    subscribeEssePermissionRequests: subscribe(permissionListeners),
    subscribeEssePreflightRequests: subscribe(preflightListeners),
    subscribeLogs: subscribe(logListeners),
    subscribeProjectSnapshotUpdates: subscribe(snapshotListeners),
    subscribeProjectThumbnailUpdates: subscribe(new Set<Listener<string>>())
  };

  harness = {
    api,
    emitAssistantMessageUpdate: (event: AgentAssistantMessageUpdateEvent) => emit(assistantUpdateListeners, event),
    emitBashExecution: (event: AgentBashExecutionEvent) => emit(bashExecutionListeners, event),
    emitChatImageGenerationStarted: (event: ChatImageGenerationStartedEvent) => emit(chatGenerationStartedListeners, event),
    emitPermissionRequest: (request: AgentPermissionRequest) => emit(permissionListeners, request),
    emitPreflightRequest: (request: AgentPreflightRequest) => emit(preflightListeners, request),
    emitProjectSnapshotUpdate: (nextSnapshot: ProjectSnapshot) => {
      snapshot = nextSnapshot;
      emit(snapshotListeners, nextSnapshot);
    },
    getSnapshot: () => snapshot,
    mocks: {
      createProject,
      importImages,
      listAgentProviders,
      respondAgentPermission,
      respondAgentPreflight,
      respondEssePermission,
      respondEssePreflight,
      saveProjectSnapshot,
      sendAgentMessage,
      sendChatMessage,
      setRunningWorkCount
    },
    renderResult: undefined as unknown as RenderResult,
    setSnapshot: (nextSnapshot: ProjectSnapshot) => {
      snapshot = nextSnapshot;
    }
  };

  window.batchImager = api;
  harness.renderResult = render(ui);
  return harness;
}

function subscribe<T>(listeners: Set<Listener<T>>): (listener: Listener<T>) => () => void {
  return (listener: Listener<T>) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
}

function emit<T>(listeners: Set<Listener<T>>, event: T): void {
  for (const listener of [...listeners]) {
    listener(event);
  }
}

function mergeSnapshot(snapshot: ProjectSnapshot, request: SaveProjectSnapshotRequest): ProjectSnapshot {
  const sessions = request.sessions ?? snapshot.sessions;
  return {
    ...snapshot,
    esseUndoLog: request.esseUndoLog ?? snapshot.esseUndoLog,
    project: {
      ...snapshot.project,
      imageCount: sessions.length
    },
    projectManagerState: request.projectManagerState ?? snapshot.projectManagerState,
    referenceImages: request.referenceImages ?? snapshot.referenceImages,
    selectedSessionId: "selectedSessionId" in request ? request.selectedSessionId ?? null : snapshot.selectedSessionId,
    sessions
  };
}

function emptyProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return {
    ...snapshot,
    esseUndoLog: undefined,
    project: {
      ...snapshot.project,
      imageCount: 0
    },
    projectManagerState: {
      conversation: { id: "project-manager-e2e", messages: [] },
      plans: []
    },
    selectedSessionId: null,
    sessions: []
  };
}

function emptyApiSettingsSnapshot(): Awaited<ReturnType<BatchImagerApi["getApiSettings"]>> {
  return {
    activeImageApiProfileId: "primary",
    imageApiKeyConfigured: false,
    imageApiProfiles: [
      {
        active: true,
        apiKeyConfigured: false,
        baseUrl: "",
        id: "primary",
        llmApiKeyConfigured: false,
        llmBaseUrl: "",
        llmModel: "",
        model: "",
        name: "主通道"
      },
      {
        active: false,
        apiKeyConfigured: false,
        baseUrl: "",
        id: "secondary",
        llmApiKeyConfigured: false,
        llmBaseUrl: "",
        llmModel: "",
        model: "",
        name: "备用通道"
      }
    ],
    imageBaseUrl: "",
    imageModel: "",
    llmApiKeyConfigured: false,
    llmBaseUrl: "",
    llmModel: ""
  };
}

function emptyEsseMemorySnapshot(): Awaited<ReturnType<BatchImagerApi["listEsseMemories"]>> {
  return {
    categories: ["用户偏好", "默认约束", "工作流惯例"],
    entries: [],
    filePath: ""
  };
}

function emptyEsseSkillsSnapshot(): Awaited<ReturnType<BatchImagerApi["listEsseSkills"]>> {
  return {
    diagnostics: [],
    disabledSkills: [],
    skillPaths: [],
    skills: []
  };
}
