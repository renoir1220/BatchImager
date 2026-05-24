import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { createAgentRuntime, type CodingAgentSdk } from "./agentRuntime";
import { loadTuziLlmConfig } from "./localConfig";
import { runEsseAgentTurn } from "./esseAgent";
import { createProjectSnapshotWorkspaceRuntime } from "./esseWorkspaceRuntime";
import type { EssePreflightPayload, ProjectSnapshot } from "../ipcTypes";
import { ProjectMutationSink } from "./projectMutationSink";
import { AgentRuntimeRegistry } from "./agentRuntimeRegistry";

const RUN_LLM_EVAL = process.env.RUN_ESSE_LLM_EVAL === "1";
const LLM_EVAL_DIAGNOSTIC_TIMEOUT_MS = 150_000;

describe.skipIf(!RUN_LLM_EVAL)("Esse workspace agent real LLM evaluation", () => {
  test.each(createRealLlmWorkspaceEvalScenarios())("$name", async (scenario) => {
    const prepared = await scenario.prepare();
    const result = await runRealLlmWorkspaceEval(prepared.input);
    await scenario.assert(result, prepared);
  }, 180_000);
});

interface RealLlmWorkspaceEvalScenario {
  assert: (result: RealLlmWorkspaceEvalResult, prepared: RealLlmWorkspaceEvalPrepared) => void | Promise<void>;
  name: string;
  prepare: () => Promise<RealLlmWorkspaceEvalPrepared>;
}

interface RealLlmWorkspaceEvalPrepared {
  imagePath?: string;
  input: RealLlmWorkspaceEvalInput;
  orphanPath?: string;
  referencedPath?: string;
}

function createRealLlmWorkspaceEvalScenarios(): RealLlmWorkspaceEvalScenario[] {
  return [
    {
      assert: (result) => {
        expect(result.trace).toContain("list_sessions");
        expect(result.trace).toContain("delete_session");
        expect(result.persisted.sessions.map((session) => session.id)).toEqual(["sess_1", "sess_3"]);
      },
      name: "deletes the second workspace image",
      prepare: async () => ({
        input: {
          initialSnapshot: createSnapshot({
            selectedSessionId: "sess_2",
            sessions: [createSession("sess_1"), createSession("sess_2"), createSession("sess_3")]
          }),
          userTask: "删掉左侧第二张图"
        }
      })
    },
    {
      assert: (result) => {
        expect(result.trace).toContain("list_sessions");
        expect(result.trace).toContain("get_session_records");
        expect(result.trace).toContain("restore_session_record");
        expect(result.trace).toContain("delete_session_record");
        if (result.persisted.sessions[0]?.generatedFilePath !== "/project/images/generated/a-1.png") {
          throw new Error(`rollback current image mismatch; calls=${JSON.stringify(result.toolCalls)}`);
        }
        expect(result.persisted.sessions[0]?.generatedFilePath).toBe("/project/images/generated/a-1.png");
        expect(result.persisted.sessions[0]?.generatedFilePaths).toEqual(["/project/images/generated/a-1.png"]);
        expect(result.persisted.sessions[0]?.chatMessages[1]?.generatedFilePath).toBeUndefined();
      },
      name: "restores record 1 then deletes record 2",
      prepare: async () => ({
        input: {
          initialSnapshot: createSnapshot({
            sessions: [
              createSession("sess_1", {
                chatMessages: [
                  {
                    content: "生成 A",
                    contextType: "generated-image",
                    generatedFilePath: "/project/images/generated/a-1.png",
                    id: "msg_1",
                    role: "context"
                  },
                  {
                    content: "生成 B",
                    contextType: "generated-image",
                    generatedFilePath: "/project/images/generated/a-2.png",
                    id: "msg_2",
                    role: "context"
                  }
                ],
                generatedFilePath: "/project/images/generated/a-2.png",
                generatedFilePaths: ["/project/images/generated/a-1.png", "/project/images/generated/a-2.png"]
              })
            ]
          }),
          userTask: "把 img-1 回退到记录 1，然后删除记录 2"
        }
      })
    },
    {
      assert: (result) => {
        expect(result.trace.filter((toolName) => toolName === "list_sessions")).toHaveLength(2);
        expect(result.trace).toContain("delete_session");
        expect(result.trace).toContain("rename_session");
        expect(result.persisted.sessions.map((session) => session.id)).toEqual(["sess_1", "sess_3"]);
        expect(result.persisted.sessions[1]?.fileName).toBe("hero-after-delete.jpg");
      },
      name: "renames the new second image after deletion",
      prepare: async () => ({
        input: {
          initialSnapshot: createSnapshot({
            selectedSessionId: "sess_2",
            sessions: [createSession("sess_1"), createSession("sess_2"), createSession("sess_3")]
          }),
          userTask: "删掉左侧第二张图，然后把现在第二张重命名为 hero-after-delete.jpg"
        }
      })
    },
    {
      assert: (result, prepared) => {
        expect(result.trace).toContain("list_sessions");
        expect(result.trace).toContain("read_image_metadata");
        const metadataCall = result.toolCalls.find((call) => call.toolName === "read_image_metadata");
        expect(metadataCall?.text).toContain("width=40");
        expect(metadataCall?.text).toContain("height=24");
        expect(metadataCall?.text).toContain("format=png");
        expect(JSON.stringify(metadataCall)).not.toContain(prepared.imagePath);
      },
      name: "reads current image metadata",
      prepare: async () => {
        const fixture = await createImageMetadataEvalFixture();
        return {
          imagePath: fixture.imagePath,
          input: {
            initialSnapshot: fixture.snapshot,
            userTask: "看一下左侧第一张当前图的尺寸和格式"
          }
        };
      }
    },
    {
      assert: async (result) => {
        expect(result.trace).toContain("add_blank_session");
        expect(result.trace).not.toContain("generate_image");
        expect(result.imageExecutionCount).toBe(0);
        expect(result.preflightPayloads).toEqual([]);
        expect(result.persisted.sessions).toHaveLength(2);
        expect(result.persisted.sessions[1]?.fileName).toBe("idea-slot.png");
        expect(result.persisted.selectedSessionId).toBe(result.persisted.sessions[1]?.id);
        await expect(sharp(result.persisted.sessions[1]?.filePath).metadata()).resolves.toMatchObject({
          format: "png",
          height: 1024,
          width: 1536
        });
      },
      name: "adds a blank placeholder session",
      prepare: async () => {
        const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-esse-llm-blank-"));
        return {
          input: {
            initialSnapshot: createSnapshot({
              project: {
                createdAt: "2026-05-24T00:00:00.000Z",
                directory: projectDirectory,
                id: "project_1",
                imageCount: 1,
                name: "LLM 空白图位评估项目",
                updatedAt: "2026-05-24T00:00:00.000Z"
              }
            }),
            userTask: "先给项目添加一个空白图片位，文件名叫 idea-slot.png，不要生成图片"
          }
        };
      }
    },
    {
      assert: (result) => {
        if (!result.trace.includes("generate_image")) {
          throw new Error(`background removal did not call generate_image; reply=${result.reply}; calls=${JSON.stringify(result.toolCalls)}`);
        }
        expect(result.trace).toContain("generate_image");
        expect(result.trace).not.toContain("delete_session");
        expect(result.preflightPayloads[0]).toMatchObject({
          estimatedApiCalls: 1,
          tool: "generate_image"
        });
        expect(result.imageExecutionCount).toBe(1);
      },
      name: "routes background removal to image preflight",
      prepare: async () => ({
        input: {
          initialSnapshot: createSnapshot({ sessions: [createSession("sess_1")] }),
          userTask: "把左侧第一张删除背景并换成白底，保留主体"
        }
      })
    },
    {
      assert: (result) => {
        if (!result.trace.includes("package_generated_images")) {
          throw new Error(`package request did not call package_generated_images; reply=${result.reply}; calls=${JSON.stringify(result.toolCalls)}`);
        }
        expect(result.trace).toContain("package_generated_images");
        expect(result.preflightPayloads[0]).toMatchObject({
          estimatedApiCalls: 0,
          tool: "package_generated_images"
        });
        expect(result.packageRequests).toEqual([{ fileName: "BatchImager-本轮生成图.zip", tool: "package_generated_images" }]);
      },
      name: "packages all generated images",
      prepare: async () => ({
        input: {
          initialSnapshot: createSnapshot({
            sessions: [
              createSession("sess_1", { generatedFilePaths: ["/project/images/generated/a.png"] }),
              createSession("sess_2", { generatedFilePaths: ["/project/images/generated/b.png"] })
            ]
          }),
          userTask: "把所有生成图打包到桌面，文件名叫 BatchImager-本轮生成图.zip"
        }
      })
    },
    {
      assert: (result) => {
        expect(result.trace).toContain("undo_last_actions");
        const undoCall = result.toolCalls.find((call) => call.toolName === "undo_last_actions");
        expect(undoCall?.text).toContain("⚠️");
        if (!/可能影响|中间|其他|回退/.test(result.reply)) {
          throw new Error(`undo warning was not reflected in reply; reply=${result.reply}; calls=${JSON.stringify(result.toolCalls)}`);
        }
        expect(result.persisted.sessions[0]?.fileName).toBe("sess_1.jpg");
      },
      name: "reports undo interleaving warnings",
      prepare: async () => ({
        input: {
          initialSnapshot: createSnapshot({
            esseUndoLog: [
              {
                affectedSessionIds: ["sess_1"],
                createdAt: "2026-05-24T00:00:00.000Z",
                id: "undo_llm_warning_1",
                inverseDescriptor: {
                  kind: "restore-workspace",
                  projectImageCount: 1,
                  selectedSessionId: "sess_1",
                  sessions: [createSession("sess_1")]
                },
                sinkRevisionAfter: 0,
                summary: "已重命名为 hero.jpg。",
                toolName: "rename_session"
              }
            ],
            sessions: [createSession("sess_1", { fileName: "hero.jpg" })]
          }),
          seedRevisionCount: 1,
          userTask: "撤销刚才那步"
        }
      })
    },
    {
      assert: async (result, prepared) => {
        expect(result.trace).toContain("scan_unreferenced_files");
        expect(result.trace).toContain("delete_unreferenced_files");
        expect(result.trace.indexOf("scan_unreferenced_files")).toBeLessThan(result.trace.indexOf("delete_unreferenced_files"));
        await expect(readFile(prepared.orphanPath ?? "")).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(prepared.referencedPath ?? "", "utf8")).resolves.toBe("referenced");
      },
      name: "cleans unreferenced generated files",
      prepare: async () => {
        const fixture = await createUnreferencedFileEvalFixture();
        return {
          input: {
            initialSnapshot: fixture.snapshot,
            userTask: "扫描并清理未引用的生成图"
          },
          orphanPath: fixture.orphanPath,
          referencedPath: fixture.referencedPath
        };
      }
    }
  ];
}

interface RealLlmWorkspaceEvalInput {
  initialSnapshot: ProjectSnapshot;
  seedRevisionCount?: number;
  userTask: string;
}

interface RealLlmWorkspaceEvalResult {
  imageExecutionCount: number;
  packageRequests: unknown[];
  persisted: ProjectSnapshot;
  preflightPayloads: EssePreflightPayload[];
  reply: string;
  toolCalls: Array<{ isError?: boolean; params: Record<string, unknown>; text: string; toolName: string }>;
  trace: string[];
}

async function runRealLlmWorkspaceEval(input: RealLlmWorkspaceEvalInput): Promise<RealLlmWorkspaceEvalResult> {
  let persisted = input.initialSnapshot;
  let imageExecutionCount = 0;
  const trace: string[] = [];
  const toolCalls: RealLlmWorkspaceEvalResult["toolCalls"] = [];
  const preflightPayloads: EssePreflightPayload[] = [];
  const packageRequests: unknown[] = [];
  const sink = new ProjectMutationSink<ProjectSnapshot>({
    applyTransaction: async (mutator) => {
      persisted = mutator(persisted);
      return persisted;
    }
  });
  for (let index = 0; index < (input.seedRevisionCount ?? 0); index += 1) {
    await sink.apply((state) => state);
  }
  const workspaceToolRuntime = createProjectSnapshotWorkspaceRuntime({
    executeImagePreflightTool: async (request) => {
      imageExecutionCount += request.commands.length;
      return {
        affectedSessionIds: request.commands.flatMap((command) => command.target.sessionId ?? []),
        ok: true,
        summary: `已模拟 ${request.commands.length} 个图片生成任务。`
      };
    },
    executePackagePreflightTool: async (request) => {
      packageRequests.push(request);
      return {
        affectedSessionIds: persisted.sessions.map((session) => session.id),
        ok: true,
        summary: "已模拟打包生成图。"
      };
    },
    initialSnapshot: input.initialSnapshot,
    requestPreflight: async (payload) => {
      preflightPayloads.push(payload);
      return { decision: "execute" };
    },
    sink
  });
  const tracedWorkspaceToolRuntime = {
    ...workspaceToolRuntime,
    recordToolCall: ({
      params,
      result,
      toolName
    }: {
      params: Record<string, unknown>;
      result: { content: Array<{ text: string }>; isError?: boolean };
      toolName: string;
    }) => {
      trace.push(toolName);
      toolCalls.push({
        isError: result.isError,
        params,
        text: result.content[0]?.text ?? "",
        toolName
      });
    }
  };

  const abortController = new AbortController();
  const result = await withLlmEvalDiagnostics(
    runEsseAgentTurn(
      {
        messages: [{ role: "user", content: input.userTask }],
        sessions: input.initialSnapshot.sessions.map((session) => ({
          currentImagePath: session.generatedFilePath ?? session.filePath,
          fileName: session.fileName,
          generatedFilePaths: session.generatedFilePaths,
          id: session.id
        }))
      },
      loadTuziLlmConfig(),
      input.initialSnapshot.project.directory,
      {
        createRuntime: async (options) =>
          createAgentRuntime({
            ...options,
            sdk: (await import("@earendil-works/pi-coding-agent")) as CodingAgentSdk
          }),
        registry: new AgentRuntimeRegistry(),
        signal: abortController.signal,
        workspaceToolRuntime: tracedWorkspaceToolRuntime
      }
    ),
    () => {
      abortController.abort();
      return {
        imageExecutionCount,
        packageRequestCount: packageRequests.length,
        preflightCount: preflightPayloads.length,
        toolCalls,
        trace,
        userTask: input.userTask
      };
    }
  );

  return {
    imageExecutionCount,
    packageRequests,
    persisted,
    preflightPayloads,
    reply: result.reply,
    toolCalls,
    trace
  };
}

async function withLlmEvalDiagnostics<T>(run: Promise<T>, getDiagnostics: () => Record<string, unknown>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const diagnostics = getDiagnostics();
      reject(new Error(`LLM eval timed out after ${LLM_EVAL_DIAGNOSTIC_TIMEOUT_MS}ms. diagnostics=${JSON.stringify(diagnostics)}`));
    }, LLM_EVAL_DIAGNOSTIC_TIMEOUT_MS);
  });

  try {
    return await Promise.race([run, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function createSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-24T00:00:00.000Z",
      directory: process.cwd(),
      id: "project_1",
      imageCount: overrides.sessions?.length ?? 1,
      name: "LLM 评估项目",
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

async function createUnreferencedFileEvalFixture(): Promise<{
  orphanPath: string;
  referencedPath: string;
  snapshot: ProjectSnapshot;
}> {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-esse-llm-unreferenced-"));
  const generatedDirectory = path.join(projectDirectory, "images", "generated");
  await mkdir(generatedDirectory, { recursive: true });
  const referencedPath = path.join(generatedDirectory, "referenced.png");
  const orphanPath = path.join(generatedDirectory, "orphan.png");
  await writeFile(referencedPath, "referenced");
  await writeFile(orphanPath, "orphan");

  return {
    orphanPath,
    referencedPath,
    snapshot: createSnapshot({
      project: {
        createdAt: "2026-05-24T00:00:00.000Z",
        directory: projectDirectory,
        id: "project_1",
        imageCount: 1,
        name: "LLM 未引用文件评估项目",
        updatedAt: "2026-05-24T00:00:00.000Z"
      },
      sessions: [
        createSession("sess_1", {
          filePath: path.join(projectDirectory, "images", "original", "a.jpg"),
          generatedFilePath: referencedPath,
          generatedFilePaths: [referencedPath]
        })
      ]
    })
  };
}

async function createImageMetadataEvalFixture(): Promise<{
  imagePath: string;
  snapshot: ProjectSnapshot;
}> {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-esse-llm-metadata-"));
  const originalDirectory = path.join(projectDirectory, "images", "original");
  await mkdir(originalDirectory, { recursive: true });
  const imagePath = path.join(originalDirectory, "metadata.png");
  await sharp({
    create: {
      background: "#ffffff",
      channels: 3,
      height: 24,
      width: 40
    }
  })
    .png()
    .toFile(imagePath);

  return {
    imagePath,
    snapshot: createSnapshot({
      project: {
        createdAt: "2026-05-24T00:00:00.000Z",
        directory: projectDirectory,
        id: "project_1",
        imageCount: 1,
        name: "LLM 图片信息评估项目",
        updatedAt: "2026-05-24T00:00:00.000Z"
      },
      sessions: [createSession("sess_1", { filePath: imagePath })]
    })
  };
}
