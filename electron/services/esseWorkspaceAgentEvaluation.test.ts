import { describe, expect, test } from "vitest";
import type { AgentRuntime, CreateAgentRuntimeOptions } from "./agentRuntime";
import { AgentRuntimeRegistry } from "./agentRuntimeRegistry";
import type { BatchImagerAgentTool } from "./batchImagerAgentTools";
import { runEsseAgentTurn } from "./esseAgent";
import { createProjectSnapshotWorkspaceRuntime } from "./esseWorkspaceRuntime";
import type { EssePreflightPayload, ProjectSnapshot } from "../ipcTypes";
import { ProjectMutationSink } from "./projectMutationSink";

interface ToolScriptStep {
  params: Record<string, unknown>;
  tool: string;
}

interface WorkspaceAgentEvalScenario {
  assert: (context: WorkspaceAgentEvalContext) => void;
  id: string;
  initialSnapshot: ProjectSnapshot;
  referenceImagePaths?: string[];
  reply: string;
  script: ToolScriptStep[];
  userTask: string;
}

interface WorkspaceAgentEvalContext {
  packageRequests: unknown[];
  persisted: ProjectSnapshot;
  preflightPayloads: EssePreflightPayload[];
  prompt: string;
  result: Awaited<ReturnType<typeof runEsseAgentTurn>>;
  toolNames: string[];
  trace: string[];
}

describe("Esse workspace agent evaluation", () => {
  test("drives realistic workspace tool-use turns without image API calls", async () => {
    for (const scenario of createWorkspaceAgentEvalScenarios()) {
      const context = await runWorkspaceAgentEvalScenario(scenario);

      try {
        scenario.assert(context);
      } catch (error) {
        throw new Error(`${scenario.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
});

function createWorkspaceAgentEvalScenarios(): WorkspaceAgentEvalScenario[] {
  return [
    {
      assert: ({ persisted, result, trace, toolNames }) => {
        expect(result.reply).toBe("这组图可以走清爽白底或浅场景两条方向。");
        expect(trace).toEqual([]);
        expect(toolNames).toContain("run_batch_generation");
        expect(persisted.sessions.map((session) => session.id)).toEqual(["sess_1"]);
      },
      id: "discussion-can-use-workspace-mode-without-json",
      initialSnapshot: createSnapshot({ sessions: [createSession("sess_1")] }),
      reply: "这组图可以走清爽白底或浅场景两条方向。",
      script: [],
      userTask: "你觉得这组图适合什么电商风格？先聊聊，不要生成"
    },
    {
      assert: ({ persisted, prompt, trace }) => {
        expect(trace).toEqual(["list_reference_images", "add_reference_image"]);
        expect(prompt).toContain("/tmp/esse-uploaded-style.png");
        expect(persisted.referenceImages).toEqual([
          {
            filePath: "/tmp/esse-uploaded-style.png",
            id: "ref_eval_1",
            label: "uploaded-style.png"
          }
        ]);
      },
      id: "register-pasted-reference-image",
      initialSnapshot: createSnapshot({ sessions: [createSession("sess_1")] }),
      referenceImagePaths: ["/tmp/esse-uploaded-style.png"],
      reply: "已把这张图添加为项目参考图。",
      script: [
        { tool: "list_reference_images", params: {} },
        {
          tool: "add_reference_image",
          params: { fileName: "uploaded-style.png", filePath: "/tmp/esse-uploaded-style.png" }
        }
      ],
      userTask: "把这张图加为项目参考图"
    },
    {
      assert: ({ persisted, prompt, result, trace }) => {
        expect(result.reply).toBe("已删除第二张，并把现在的第二张重命名为 hero-after-delete.jpg。");
        expect(trace).toEqual(["list_sessions", "delete_session", "list_sessions", "rename_session"]);
        expect(prompt).toContain("工作区工具模式");
        expect(prompt).toContain("工作区数量或顺序发生变化");
        expect(persisted.sessions.map((session) => session.id)).toEqual(["sess_1", "sess_3"]);
        expect(persisted.sessions[1]?.fileName).toBe("hero-after-delete.jpg");
        expect(persisted.selectedSessionId).toBe("sess_3");
      },
      id: "delete-then-rename-current-second",
      initialSnapshot: createSnapshot({
        selectedSessionId: "sess_2",
        sessions: [createSession("sess_1"), createSession("sess_2"), createSession("sess_3")]
      }),
      reply: "已删除第二张，并把现在的第二张重命名为 hero-after-delete.jpg。",
      script: [
        { tool: "list_sessions", params: {} },
        { tool: "delete_session", params: { sessionId: "sess_2" } },
        { tool: "list_sessions", params: {} },
        { tool: "rename_session", params: { fileName: "hero-after-delete.jpg", sessionId: "sess_3" } }
      ],
      userTask: "删掉左侧第二张图，然后把现在第二张重命名为 hero-after-delete.jpg"
    },
    {
      assert: ({ persisted, preflightPayloads, trace }) => {
        expect(trace).toEqual(["list_sessions", "generate_image"]);
        expect(trace).not.toContain("delete_session");
        expect(persisted.sessions).toHaveLength(1);
        expect(preflightPayloads).toEqual([
          {
            commands: [
              {
                displayLabel: "img-1",
                mode: "edit",
                prompt: "删除背景并换成白底，保留主体",
                target: { sessionId: "sess_1", type: "existing" }
              }
            ],
            estimatedApiCalls: 1,
            tool: "generate_image"
          }
        ]);
      },
      id: "background-removal-is-image-preflight",
      initialSnapshot: createSnapshot({ sessions: [createSession("sess_1")] }),
      reply: "已创建删除背景并换白底的生成确认。",
      script: [
        { tool: "list_sessions", params: {} },
        {
          tool: "generate_image",
          params: {
            mode: "edit",
            prompt: "删除背景并换成白底，保留主体",
            target: { sessionId: "sess_1", type: "existing" }
          }
        }
      ],
      userTask: "把左侧第一张删除背景并换成白底"
    },
    {
      assert: ({ preflightPayloads, prompt, trace }) => {
        expect(trace).toEqual(["list_sessions", "run_batch_generation"]);
        expect(prompt).toContain("编辑现有工作区图片时先 list_sessions");
        expect(prompt).not.toContain("/project/images");
        expect(preflightPayloads).toEqual([
          {
            commands: [
              {
                displayLabel: "img-1",
                mode: "edit",
                prompt: "把商品改成手持展示姿势，保留主体",
                target: { sessionId: "sess_1", type: "existing" }
              },
              {
                displayLabel: "img-2",
                mode: "edit",
                prompt: "把商品改成手持展示姿势，保留主体",
                target: { sessionId: "sess_2", type: "existing" }
              }
            ],
            estimatedApiCalls: 2,
            tool: "run_batch_generation"
          }
        ]);
      },
      id: "batch-edit-uses-run-batch-generation-preflight",
      initialSnapshot: createSnapshot({
        sessions: [createSession("sess_1"), createSession("sess_2")]
      }),
      reply: "已创建两张图的批量生成确认。",
      script: [
        { tool: "list_sessions", params: {} },
        {
          tool: "run_batch_generation",
          params: {
            commands: [
              {
                mode: "edit",
                prompt: "把商品改成手持展示姿势，保留主体",
                target: { sessionId: "sess_1", type: "existing" }
              },
              {
                mode: "edit",
                prompt: "把商品改成手持展示姿势，保留主体",
                target: { sessionId: "sess_2", type: "existing" }
              }
            ]
          }
        }
      ],
      userTask: "把左侧第一张和第二张批量处理成手持展示姿势，保留主体"
    },
    {
      assert: ({ preflightPayloads, prompt, result, trace }) => {
        expect(result.reply).toBe("已提交 4 个鲜花图生成任务，会在后台完成。");
        expect(trace).toEqual(["run_batch_generation"]);
        expect(prompt).toContain("全新生成 N 张图");
        expect(prompt).toContain("不要说“已经生成完成”");
        expect(preflightPayloads).toEqual([
          {
            commands: [
              {
                mode: "generate",
                prompt: "鲜花电商主图，明亮自然光，干净背景，构图精致",
                target: { fileName: "flower-1.png", type: "new" }
              },
              {
                mode: "generate",
                prompt: "鲜花电商主图，浅色场景，柔和阴影，适合商品展示",
                target: { fileName: "flower-2.png", type: "new" }
              },
              {
                mode: "generate",
                prompt: "鲜花电商主图，白底高质感，花束居中，细节清晰",
                target: { fileName: "flower-3.png", type: "new" }
              },
              {
                mode: "generate",
                prompt: "鲜花电商主图，春日氛围，清爽明亮，适合首页展示",
                target: { fileName: "flower-4.png", type: "new" }
              }
            ],
            estimatedApiCalls: 4,
            tool: "run_batch_generation"
          }
        ]);
      },
      id: "new-image-batch-generation-skips-list-sessions",
      initialSnapshot: createSnapshot({ sessions: [] }),
      reply: "已提交 4 个鲜花图生成任务，会在后台完成。",
      script: [
        {
          tool: "run_batch_generation",
          params: {
            commands: [
              {
                mode: "generate",
                prompt: "鲜花电商主图，明亮自然光，干净背景，构图精致",
                target: { fileName: "flower-1.png", type: "new" }
              },
              {
                mode: "generate",
                prompt: "鲜花电商主图，浅色场景，柔和阴影，适合商品展示",
                target: { fileName: "flower-2.png", type: "new" }
              },
              {
                mode: "generate",
                prompt: "鲜花电商主图，白底高质感，花束居中，细节清晰",
                target: { fileName: "flower-3.png", type: "new" }
              },
              {
                mode: "generate",
                prompt: "鲜花电商主图，春日氛围，清爽明亮，适合首页展示",
                target: { fileName: "flower-4.png", type: "new" }
              }
            ]
          }
        }
      ],
      userTask: "生成 4 张鲜花图"
    },
    {
      assert: ({ preflightPayloads, result, trace }) => {
        expect(result.reply).toBe("已创建这批图的春季电商方案确认。");
        expect(trace).toEqual(["list_sessions", "run_batch_generation"]);
        expect(preflightPayloads).toEqual([
          {
            commands: [
              {
                displayLabel: "img-1",
                mode: "edit",
                prompt: "春季电商主图方案：明亮自然光、清爽浅色背景、保留商品主体和比例",
                target: { sessionId: "sess_1", type: "existing" }
              },
              {
                displayLabel: "img-2",
                mode: "edit",
                prompt: "春季电商主图方案：明亮自然光、清爽浅色背景、保留商品主体和比例",
                target: { sessionId: "sess_2", type: "existing" }
              }
            ],
            estimatedApiCalls: 2,
            tool: "run_batch_generation"
          }
        ]);
      },
      id: "batch-plan-language-uses-tool-preflight",
      initialSnapshot: createSnapshot({
        sessions: [createSession("sess_1"), createSession("sess_2")]
      }),
      reply: "已创建这批图的春季电商方案确认。",
      script: [
        { tool: "list_sessions", params: {} },
        {
          tool: "run_batch_generation",
          params: {
            commands: [
              {
                mode: "edit",
                prompt: "春季电商主图方案：明亮自然光、清爽浅色背景、保留商品主体和比例",
                target: { sessionId: "sess_1", type: "existing" }
              },
              {
                mode: "edit",
                prompt: "春季电商主图方案：明亮自然光、清爽浅色背景、保留商品主体和比例",
                target: { sessionId: "sess_2", type: "existing" }
              }
            ]
          }
        }
      ],
      userTask: "帮这批图做一套春季电商主图方案"
    },
    {
      assert: ({ packageRequests, preflightPayloads, trace }) => {
        expect(trace).toEqual(["list_sessions", "package_generated_images"]);
        expect(preflightPayloads[0]).toMatchObject({
          estimatedApiCalls: 0,
          tool: "package_generated_images"
        });
        expect(packageRequests).toEqual([{ fileName: "BatchImager-本轮生成图.zip", tool: "package_generated_images" }]);
      },
      id: "package-all-generated-images-zero-api",
      initialSnapshot: createSnapshot({
        sessions: [
          createSession("sess_1", { generatedFilePaths: ["/project/images/generated/a.png"] }),
          createSession("sess_2", { generatedFilePaths: ["/project/images/generated/b.png"] })
        ]
      }),
      reply: "已把全部生成图打包到桌面。",
      script: [
        { tool: "list_sessions", params: {} },
        { tool: "package_generated_images", params: { fileName: "BatchImager-本轮生成图.zip" } }
      ],
      userTask: "把所有生成图打包到桌面，文件名叫 BatchImager-本轮生成图.zip"
    }
  ];
}

async function runWorkspaceAgentEvalScenario(scenario: WorkspaceAgentEvalScenario): Promise<WorkspaceAgentEvalContext> {
  let persisted = scenario.initialSnapshot;
  let prompt = "";
  let toolNames: string[] = [];
  const trace: string[] = [];
  const preflightPayloads: EssePreflightPayload[] = [];
  const packageRequests: unknown[] = [];
  const sink = new ProjectMutationSink<ProjectSnapshot>({
    applyTransaction: async (mutator) => {
      persisted = mutator(persisted);
      return persisted;
    }
  });
  const baseWorkspaceToolRuntime = createProjectSnapshotWorkspaceRuntime({
    executeImagePreflightTool: async (request) => ({
      affectedSessionIds: request.commands.flatMap((command) => command.target.sessionId ?? []),
      ok: true,
      summary: "已提交图片生成预检。"
    }),
    executePackagePreflightTool: async (request) => {
      packageRequests.push(request);
      return { affectedSessionIds: persisted.sessions.map((session) => session.id), ok: true, summary: "已打包生成图。" };
    },
    getTurnReferenceImagePaths: () => scenario.referenceImagePaths ?? [],
    initialSnapshot: scenario.initialSnapshot,
    requestPreflight: async (payload) => {
      preflightPayloads.push(payload);
      return { decision: "execute" };
    },
    sink
  });
  const workspaceToolRuntime = {
    ...baseWorkspaceToolRuntime,
    addReferenceImage: async (request) => {
      const mutation = await baseWorkspaceToolRuntime.applyMutation((state) => {
        const referenceId = `ref_eval_${(state.referenceImages ?? []).length + 1}`;
        const label = request.fileName ?? request.filePath.split(/[\\/]/).filter(Boolean).pop() ?? "reference.png";
        return {
          result: { affectedSessionIds: [], ok: true as const, summary: `已添加参考图：${label}` },
          state: {
            ...state,
            referenceImages: [
              ...(state.referenceImages ?? []),
              {
                filePath: request.filePath,
                id: referenceId,
                label
              }
            ]
          }
        };
      });
      return mutation.result;
    }
  };

  const result = await runEsseAgentTurn(
    {
      messages: [{ role: "user", content: scenario.userTask }],
      referenceImagePaths: scenario.referenceImagePaths,
      sessions: scenario.initialSnapshot.sessions.map((session) => ({
        currentImagePath: session.generatedFilePath ?? session.filePath,
        fileName: session.fileName,
        generatedFilePaths: session.generatedFilePaths,
        id: session.id
      }))
    },
    { apiKey: "esse-eval-key", baseUrl: "https://example.invalid/v1", model: "esse-eval-model" },
    scenario.initialSnapshot.project.directory,
    {
      createRuntime: async (options) => {
        const tools = (options.customToolDefinitions ?? []) as BatchImagerAgentTool[];
        toolNames = tools.map((tool) => tool.name);
        return createScriptedRuntime({
          onPrompt: async (nextPrompt) => {
            prompt = nextPrompt;
            await runToolScript(tools, scenario.script, trace);
          },
          reply: scenario.reply,
          sessionOptions: options
        });
      },
      registry: new AgentRuntimeRegistry(),
      workspaceToolRuntime
    }
  );

  return {
    packageRequests,
    persisted,
    preflightPayloads,
    prompt,
    result,
    toolNames,
    trace
  };
}

async function runToolScript(tools: BatchImagerAgentTool[], script: ToolScriptStep[], trace: string[]): Promise<void> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const [index, step] of script.entries()) {
    const tool = byName.get(step.tool);
    if (!tool) {
      throw new Error(`missing tool ${step.tool}`);
    }

    trace.push(step.tool);
    const result = await tool.execute(`eval-call-${index + 1}`, step.params);
    if (result.isError) {
      throw new Error(`${step.tool} failed: ${result.content[0]?.text ?? "unknown error"}`);
    }
  }
}

function createScriptedRuntime(options: {
  onPrompt: (prompt: string) => Promise<void>;
  reply: string;
  sessionOptions: CreateAgentRuntimeOptions;
}): AgentRuntime {
  return {
    abort: async () => undefined,
    descriptor: {
      builtInTools: [],
      customTools: options.sessionOptions.customToolDefinitions?.map((tool) => (tool as { name?: string }).name ?? "") ?? [],
      model: options.sessionOptions.model,
      projectDirectory: options.sessionOptions.projectDirectory,
      sessionId: "esse-workspace-agent-eval"
    },
    dispose: () => undefined,
    getLastAssistantText: () => options.reply,
    prompt: options.onPrompt,
    subscribe: () => () => undefined
  };
}

function createSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-24T00:00:00.000Z",
      directory: "/project",
      id: "project_1",
      imageCount: overrides.sessions?.length ?? 1,
      name: "测试项目",
      updatedAt: "2026-05-24T00:00:00.000Z"
    },
    selectedSessionId: overrides.sessions?.[0]?.id ?? "sess_1",
    sessions: [createSession("sess_1")],
    ...overrides
  };
}

function createSession(sessionId: string, overrides: Partial<ProjectSnapshot["sessions"][number]> = {}): ProjectSnapshot["sessions"][number] {
  return {
    chatMessages: [],
    chatStatus: "idle",
    fileName: `${sessionId}.jpg`,
    filePath: `/project/images/original/${sessionId}.jpg`,
    id: sessionId,
    status: "idle",
    ...overrides
  };
}
