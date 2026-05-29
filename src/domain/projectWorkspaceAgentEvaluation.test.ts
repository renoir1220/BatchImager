import { describe, expect, test } from "vitest";
import type { ImageSession } from "../types/image";
import type { ProjectMutationResult, ProjectState } from "./projectMutations";
import { createProjectWorkspaceTools, type ProjectWorkspaceTool, type ProjectWorkspaceToolRuntime } from "./projectWorkspaceTools";

type WorkspaceScenarioStep =
  | { tool: "get_session_records"; sessionId: string }
  | { tool: "list_sessions" }
  | { tool: "delete_session"; sessionId: string }
  | { tool: "delete_session_record"; recordIndex: number; sessionId: string }
  | { tool: "merge_sessions"; sourceSessionIds: string[]; targetSessionId: string }
  | { tool: "rename_session"; fileName: string; sessionId: string }
  | { tool: "reorder_sessions"; sessionIds: string[] }
  | { tool: "restore_original"; sessionId: string }
  | { tool: "restore_session_record"; recordIndex: number; sessionId: string }
  | { tool: "set_session_prompt"; prompt: string; sessionId: string };

interface WorkspaceScenario {
  assert: (state: ProjectState) => void;
  id: string;
  initialState: ProjectState;
  requiredTraceChecks: WorkspaceTraceCheck[];
  steps: WorkspaceScenarioStep[];
  title: string;
  userTask: string;
}

interface WorkspaceTraceEntry {
  isError: boolean;
  params: Record<string, unknown>;
  tool: string;
}

interface WorkspaceTraceCheck {
  name: string;
  evaluate: (trace: WorkspaceTraceEntry[]) => boolean;
}

describe("project workspace agent evaluation", () => {
  test("simulates realistic agent workspace tasks without image API calls", () => {
    const report = runWorkspaceAgentEvaluation(createWorkspaceScenarios());

    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(report.total);
  });

  test("flags workspace plans that skip required read-before-write behavior", () => {
    const report = runWorkspaceAgentEvaluation([
      {
        ...createWorkspaceScenarios()[0],
        id: "unsafe-no-read-before-delete",
        steps: [
          { tool: "restore_session_record", sessionId: "sess_1", recordIndex: 1 },
          { tool: "delete_session_record", sessionId: "sess_1", recordIndex: 2 }
        ]
      }
    ]);

    expect(report.failures).toEqual([
      "unsafe-no-read-before-delete: trace check failed: calls list_sessions before workspace writes",
      "unsafe-no-read-before-delete: trace check failed: calls get_session_records before record writes"
    ]);
  });
});

function runWorkspaceAgentEvaluation(scenarios: WorkspaceScenario[]): { failures: string[]; passed: number; total: number } {
  const failures: string[] = [];

  for (const scenario of scenarios) {
    const runtime = createRuntime(scenario.initialState);
    const tools = indexTools(createProjectWorkspaceTools(runtime));
    const trace: WorkspaceTraceEntry[] = [];

    for (const step of scenario.steps) {
      const result = executeStep(tools, step);
      trace.push({
        isError: result.isError === true,
        params: step,
        tool: step.tool
      });
      if (result.isError) {
        failures.push(`${scenario.id}: ${step.tool} failed: ${result.content[0]?.text ?? "unknown error"}`);
        break;
      }
    }

    for (const check of scenario.requiredTraceChecks) {
      if (!check.evaluate(trace)) {
        failures.push(`${scenario.id}: trace check failed: ${check.name}`);
      }
    }

    try {
      scenario.assert(runtime.getState());
    } catch (error) {
      failures.push(`${scenario.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    failures,
    passed: scenarios.length - failures.length,
    total: scenarios.length
  };
}

function executeStep(tools: Record<string, ProjectWorkspaceTool>, step: WorkspaceScenarioStep) {
  return tools[step.tool].execute(step);
}

function indexTools(tools: ProjectWorkspaceTool[]): Record<string, ProjectWorkspaceTool> {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function createRuntime(initialState: ProjectState): ProjectWorkspaceToolRuntime & { getState: () => ProjectState } {
  let state = initialState;
  return {
    applyMutation: (mutator: (state: ProjectState) => ProjectMutationResult) => {
      const result = mutator(state);
      if (result.result.ok) {
        state = result.state;
      }
      return result;
    },
    getState: () => state
  };
}

function createWorkspaceScenarios(): WorkspaceScenario[] {
  return [
    {
      assert: (state) => {
        const session = state.sessions.find((current) => current.id === "sess_1");
        expect(session?.generatedFilePath).toBe("C:/generated/1-a.png");
        expect(session?.generatedFilePaths).toEqual(["C:/generated/1-a.png"]);
        expect(session?.chatMessages[1]?.generatedFilePath).toBeUndefined();
      },
      id: "rollback-and-delete-record",
      initialState: makeState([
        makeSession("sess_1", {
          chatMessages: [
            { id: "m-1", role: "context", content: "生成 A", contextType: "generated-image", generatedFilePath: "C:/generated/1-a.png" },
            { id: "m-2", role: "context", content: "生成 B", contextType: "generated-image", generatedFilePath: "C:/generated/1-b.png" }
          ],
          generatedFilePath: "C:/generated/1-b.png",
          generatedFilePaths: ["C:/generated/1-a.png", "C:/generated/1-b.png"]
        })
      ]),
      requiredTraceChecks: [requiresListBeforeWrites(), requiresRecordsBeforeRecordWrites("sess_1")],
      steps: [
        { tool: "list_sessions" },
        { tool: "get_session_records", sessionId: "sess_1" },
        { tool: "restore_session_record", sessionId: "sess_1", recordIndex: 1 },
        { tool: "delete_session_record", sessionId: "sess_1", recordIndex: 2 }
      ],
      title: "回退到记录 1 并删除记录 2",
      userTask: "把第一张图回退到记录1，然后删掉记录2"
    },
    {
      assert: (state) => {
        expect(state.sessions.map((session) => session.id)).toEqual(["sess_1", "sess_3"]);
        expect(state.selectedSessionId).toBe("sess_3");
      },
      id: "delete-left-workspace-image",
      initialState: makeState([makeSession("sess_1"), makeSession("sess_2"), makeSession("sess_3")], "sess_2"),
      requiredTraceChecks: [requiresListBeforeWrites()],
      steps: [
        { tool: "list_sessions" },
        { tool: "delete_session", sessionId: "sess_2" }
      ],
      title: "删除左侧工作区中间图片",
      userTask: "删掉左侧第二张图"
    },
    {
      assert: (state) => {
        expect(state.sessions.map((session) => session.id)).toEqual(["sess_real_1", "sess_real_3"]);
        expect(state.selectedSessionId).toBe("sess_real_3");
      },
      id: "display-label-resolved-to-stable-id",
      initialState: makeState([makeSession("sess_real_1"), makeSession("sess_real_2"), makeSession("sess_real_3")], "sess_real_2"),
      requiredTraceChecks: [requiresListBeforeWrites(), forbidsDisplayLabelAsSessionId()],
      steps: [
        { tool: "list_sessions" },
        { tool: "delete_session", sessionId: "sess_real_2" }
      ],
      title: "用稳定 id 执行用户口中的 img-2",
      userTask: "删掉 img-2"
    },
    {
      assert: (state) => {
        expect(state.sessions.map((session) => session.id)).toEqual(["sess_target"]);
        expect(state.sessions[0].generatedFilePaths).toEqual([
          "C:/generated/target.png",
          "C:/generated/source-a.png",
          "C:/generated/source-b.png"
        ]);
      },
      id: "merge-sessions",
      initialState: makeState([
        makeSession("sess_target", {
          generatedFilePath: "C:/generated/target.png",
          generatedFilePaths: ["C:/generated/target.png"]
        }),
        makeSession("sess_source", {
          generatedFilePath: "C:/generated/source-b.png",
          generatedFilePaths: ["C:/generated/source-a.png", "C:/generated/source-b.png"]
        })
      ]),
      requiredTraceChecks: [requiresListBeforeWrites()],
      steps: [
        { tool: "list_sessions" },
        { tool: "merge_sessions", targetSessionId: "sess_target", sourceSessionIds: ["sess_source"] }
      ],
      title: "合并两个工作区图片记录",
      userTask: "把第二张图的生成记录并到第一张，第二张不要单独留着"
    },
    {
      assert: (state) => {
        expect(state.sessions.map((session) => session.id)).toEqual(["sess_b", "sess_a"]);
        expect(state.sessions[0].fileName).toBe("hero-b.jpg");
        expect(state.sessions[0].lastPrompt).toBe("白底主图，保留主体比例");
        expect(state.sessions[0].generatedFilePath).toBeUndefined();
        expect(state.sessions[0].generatedFilePaths).toEqual(["C:/generated/b.png"]);
      },
      id: "safe-workspace-writes",
      initialState: makeState([
        makeSession("sess_a"),
        makeSession("sess_b", {
          generatedFilePath: "C:/generated/b.png",
          generatedFilePaths: ["C:/generated/b.png"]
        })
      ]),
      requiredTraceChecks: [requiresListBeforeWrites(), forbidsDisplayLabelAsSessionId()],
      steps: [
        { tool: "list_sessions" },
        { tool: "rename_session", sessionId: "sess_b", fileName: "hero-b.jpg" },
        { tool: "set_session_prompt", sessionId: "sess_b", prompt: "白底主图，保留主体比例" },
        { tool: "restore_original", sessionId: "sess_b" },
        { tool: "reorder_sessions", sessionIds: ["sess_b", "sess_a"] }
      ],
      title: "重命名、设置默认提示词、恢复原图并重排",
      userTask: "把第二张图重命名为 hero-b.jpg，默认提示词改成白底主图，恢复原图，并放到第一张"
    }
  ];
}

function requiresListBeforeWrites(): WorkspaceTraceCheck {
  return {
    name: "calls list_sessions before workspace writes",
    evaluate: (trace) => {
      const firstWriteIndex = trace.findIndex((entry) => isWorkspaceWrite(entry.tool));
      const listIndex = trace.findIndex((entry) => entry.tool === "list_sessions" && !entry.isError);
      return firstWriteIndex < 0 || (listIndex >= 0 && listIndex < firstWriteIndex);
    }
  };
}

function requiresRecordsBeforeRecordWrites(sessionId: string): WorkspaceTraceCheck {
  return {
    name: "calls get_session_records before record writes",
    evaluate: (trace) => {
      const firstRecordWriteIndex = trace.findIndex(
        (entry) =>
          (entry.tool === "restore_session_record" || entry.tool === "delete_session_record") &&
          (entry.params as { sessionId?: unknown }).sessionId === sessionId
      );
      const recordsIndex = trace.findIndex(
        (entry) => entry.tool === "get_session_records" && !entry.isError && (entry.params as { sessionId?: unknown }).sessionId === sessionId
      );
      return firstRecordWriteIndex < 0 || (recordsIndex >= 0 && recordsIndex < firstRecordWriteIndex);
    }
  };
}

function isWorkspaceWrite(tool: string): boolean {
  return [
    "delete_session",
    "delete_session_record",
    "merge_sessions",
    "rename_session",
    "reorder_sessions",
    "restore_original",
    "restore_session_record",
    "set_session_prompt"
  ].includes(tool);
}

function forbidsDisplayLabelAsSessionId(): WorkspaceTraceCheck {
  return {
    name: "uses stable session ids instead of display labels",
    evaluate: (trace) =>
      trace.every((entry) => {
        const sessionId = (entry.params as { sessionId?: unknown }).sessionId;
        const sessionIds = (entry.params as { sessionIds?: unknown }).sessionIds;
        const targetSessionId = (entry.params as { targetSessionId?: unknown }).targetSessionId;
        const sourceSessionIds = (entry.params as { sourceSessionIds?: unknown }).sourceSessionIds;
        return (
          !isDisplayLabel(sessionId) &&
          !(Array.isArray(sessionIds) && sessionIds.some(isDisplayLabel)) &&
          !isDisplayLabel(targetSessionId) &&
          !(Array.isArray(sourceSessionIds) && sourceSessionIds.some(isDisplayLabel))
        );
      })
  };
}

function isDisplayLabel(value: unknown): boolean {
  return typeof value === "string" && /^img-\d+$/i.test(value.trim());
}

function makeState(sessions: ImageSession[], selectedSessionId = sessions[0]?.id ?? null): ProjectState {
  return {
    project: { directory: "C:/project", name: "评估项目" },
    projectManagerState: {
      conversation: { id: "conversation-1", messages: [] },
      plans: []
    },
    referenceImages: [],
    selectedSessionId,
    sessions
  };
}

function makeSession(id: string, overrides: Partial<ImageSession> = {}): ImageSession {
  return {
    chatMessages: [],
    chatStatus: "idle",
    fileName: `${id}.jpg`,
    filePath: `C:/source/${id}.jpg`,
    id,
    status: "idle",
    ...overrides
  };
}
