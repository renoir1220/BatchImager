import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import { createEsseWorkspaceTools } from "./esseWorkspaceTools";
import type { EsseImagePreflightExecutionRequest, EssePreflightPayload, EsseWorkspacePermissionRequest } from "./esseWorkspaceTools";
import { createProjectSnapshotWorkspaceRuntime } from "./esseWorkspaceRuntime";
import { ProjectMutationSink } from "./projectMutationSink";

describe("esseWorkspaceRuntime", () => {
  test("persists workspace tool mutations through the project mutation sink", async () => {
    let persisted = createSnapshot();
    const broadcasts: ProjectSnapshot[] = [];
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      },
      broadcast: (state) => broadcasts.push(state)
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = createEsseWorkspaceTools(runtime);

    await toolsByName(tools).get("delete_session_record")?.execute("call-1", { recordIndex: 2, sessionId: "sess_1" });

    expect(persisted.sessions[0]?.generatedFilePaths).toEqual(["/project/generated/a-1.png"]);
    expect(persisted.sessions[0]?.generatedFilePath).toBe("/project/generated/a-1.png");
    expect(persisted.sessions[0]?.chatMessages[0]?.generatedFilePath).toBeUndefined();
    expect(runtime.getState()).toBe(persisted);
    expect(broadcasts).toHaveLength(1);
  });

  test("does not persist or broadcast rejected workspace mutations", async () => {
    let persisted = createSnapshot();
    const broadcasts: ProjectSnapshot[] = [];
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      },
      broadcast: (state) => broadcasts.push(state)
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = createEsseWorkspaceTools(runtime);

    const result = await toolsByName(tools).get("delete_session_record")?.execute("call-1", { recordIndex: 9, sessionId: "sess_1" });

    expect(result?.isError).toBe(true);
    expect(persisted).toEqual(createSnapshot());
    expect(broadcasts).toHaveLength(0);
  });

  test("runs each workspace mutation only once through the sink state", async () => {
    let persisted = createSnapshot();
    let calls = 0;
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });

    const mutation = await runtime.applyMutation((state) => {
      calls += 1;
      return {
        result: { affectedSessionIds: ["sess_1"], ok: true, summary: "changed once" },
        state: {
          ...state,
          sessions: state.sessions.map((session) =>
            session.id === "sess_1" ? { ...session, fileName: `changed-${calls}.png` } : session
          )
        }
      };
    });

    expect(calls).toBe(1);
    expect(mutation.result).toMatchObject({ ok: true, summary: "changed once" });
    expect(persisted.sessions[0]?.fileName).toBe("changed-1.png");
  });

  test("enforces per-turn tool and write call budgets", async () => {
    let persisted = createSnapshot();
    const budget = {
      deadline: Date.now() + 60_000,
      toolCalls: { limit: 30, used: 0 },
      writeCalls: { limit: 10, used: 0 }
    };
    const runtime = createProjectSnapshotWorkspaceRuntime({
      initialSnapshot: persisted,
      sink: new ProjectMutationSink<ProjectSnapshot>({
        applyTransaction: async (mutator) => {
          persisted = mutator(persisted);
          return persisted;
        }
      })
    });
    const budgetedRuntime = {
      ...runtime,
      getTurnBudget: () => budget
    };
    const tools = toolsByName(createEsseWorkspaceTools(budgetedRuntime));

    for (let index = 0; index < 30; index += 1) {
      const result = await tools.get("list_sessions")?.execute(`read-${index}`, {});
      expect(result?.isError).toBeUndefined();
    }
    const overReadLimit = await tools.get("list_sessions")?.execute("read-over", {});
    expect(overReadLimit?.isError).toBe(true);
    expect(overReadLimit?.content[0]?.text).toContain("Tool call limit reached");

    budget.toolCalls.used = 0;
    budget.writeCalls.used = 0;
    for (let index = 0; index < 10; index += 1) {
      const result = await tools.get("rename_session")?.execute(`write-${index}`, {
        fileName: `flower-${index}.png`,
        sessionId: "sess_1"
      });
      expect(result?.isError).toBeUndefined();
    }
    const overWriteLimit = await tools.get("rename_session")?.execute("write-over", {
      fileName: "flower-over.png",
      sessionId: "sess_1"
    });
    expect(overWriteLimit?.isError).toBe(true);
    expect(overWriteLimit?.content[0]?.text).toContain("Write tool call limit reached");
  });

  test("accepts numeric string record indexes from LLM tool calls", async () => {
    let persisted = createSnapshot();
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = createEsseWorkspaceTools(runtime);

    await toolsByName(tools).get("restore_session_record")?.execute("call-1", { recordIndex: "1", sessionId: "sess_1" });
    await toolsByName(tools).get("delete_session_record")?.execute("call-2", { recordIndex: "2", sessionId: "sess_1" });

    expect(persisted.sessions[0]?.generatedFilePath).toBe("/project/generated/a-1.png");
    expect(persisted.sessions[0]?.generatedFilePaths).toEqual(["/project/generated/a-1.png"]);
  });

  test("records workspace tool calls as persisted project-manager context messages", async () => {
    let persisted = createSnapshot();
    const broadcasts: ProjectSnapshot[] = [];
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      },
      broadcast: (state) => broadcasts.push(state)
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, recordToolCalls: true, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("list_sessions")?.execute("call-1", {});
    await tools.get("delete_session_record")?.execute("call-2", { recordIndex: "2", sessionId: "sess_1" });

    const messages = persisted.projectManagerState?.conversation.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      content: expect.stringContaining("Esse 工具调用：list_sessions（完成）"),
      contextType: "esse-tool-call",
      role: "context"
    });
    expect(messages[1]).toMatchObject({
      content: expect.stringContaining("Esse 工具调用：delete_session_record（完成）"),
      contextType: "esse-tool-call",
      role: "context"
    });
    expect(persisted.sessions[0]?.generatedFilePaths).toEqual(["/project/generated/a-1.png"]);
    expect(runtime.getState().projectManagerState?.conversation.messages).toHaveLength(2);
    expect(broadcasts).toHaveLength(3);
  });

  test("returns safe workspace references without exposing local file paths to the model", async () => {
    const snapshot = createSnapshot({
      sessions: [
        createSession("sess_1", {
          filePath: "/private/project/images/original/a.jpg",
          generatedFilePath: "/private/project/images/generated/a-2.png",
          generatedFilePaths: ["/private/project/images/generated/a-1.png", "/private/project/images/generated/a-2.png"]
        })
      ]
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: snapshot, sink: createNoopSink() });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const listResult = await tools.get("list_sessions")?.execute("call-list", {});
    const recordResult = await tools.get("get_session_records")?.execute("call-records", { sessionId: "sess_1" });

    expect(listResult?.details?.sessions).toEqual([
      expect.objectContaining({ currentImageSource: "generated", displayLabel: "img-1", id: "sess_1" })
    ]);
    expect(recordResult?.details?.records).toEqual([
      { fileName: "a-1.png", isCurrent: false, recordIndex: 1 },
      { fileName: "a-2.png", isCurrent: true, recordIndex: 2 }
    ]);
    expect(JSON.stringify(listResult)).not.toContain("/private/project");
    expect(JSON.stringify(recordResult)).not.toContain("/private/project");
  });

  test("executes safe workspace writes without image API side effects", async () => {
    let persisted = createSnapshot({
      selectedSessionId: "sess_2",
      sessions: [
        createSession("sess_1", { fileName: "old-a.jpg", lastPrompt: "旧提示词" }),
        createSession("sess_2", {
          generatedFilePath: "/project/generated/b-1.png",
          generatedFilePaths: ["/project/generated/b-1.png"]
        })
      ]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("rename_session")?.execute("call-1", { fileName: "hero-a.jpg", sessionId: "sess_1" });
    await tools.get("set_session_prompt")?.execute("call-2", { prompt: "白底主图，保留主体", sessionId: "sess_1" });
    await tools.get("restore_original")?.execute("call-3", { sessionId: "sess_2" });
    await tools.get("reorder_sessions")?.execute("call-4", { sessionIds: ["sess_2", "sess_1"] });

    expect(persisted.sessions.map((session) => session.id)).toEqual(["sess_2", "sess_1"]);
    expect(persisted.sessions[1]?.fileName).toBe("hero-a.jpg");
    expect(persisted.sessions[1]?.lastPrompt).toBe("白底主图，保留主体");
    expect(persisted.sessions[0]?.generatedFilePath).toBeUndefined();
    expect(persisted.sessions[0]?.generatedFilePaths).toEqual(["/project/generated/b-1.png"]);
  });

  test("declares risk and preflight metadata for every workspace tool", () => {
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: createSnapshot(), sink: createNoopSink() });
    const tools = createEsseWorkspaceTools(runtime);

    expect(tools.every((tool) => tool.risk && typeof tool.requiresPreflight === "boolean")).toBe(true);
    expect(toolsByName(tools).get("list_sessions")).toMatchObject({ risk: "read", requiresPreflight: false });
    expect(toolsByName(tools).get("rename_session")).toMatchObject({ risk: "safe-write", requiresPreflight: false });
    expect(toolsByName(tools).get("delete_session")).toMatchObject({ risk: "destructive", requiresPreflight: false });
    expect(toolsByName(tools).get("generate_image")).toMatchObject({ risk: "safe-write", requiresPreflight: true });
    expect(toolsByName(tools).get("package_generated_images")).toMatchObject({
      risk: "external-write",
      requiresPreflight: true
    });
  });

  test("routes non-read workspace tools through permission before preflight or mutation", async () => {
    const permissionRequests: EsseWorkspacePermissionRequest[] = [];
    const preflightPayloads: EssePreflightPayload[] = [];
    let persisted = createSnapshot({
      sessions: [
        createSession("sess_1", {
          generatedFilePaths: ["/project/generated/a.png"]
        }),
        createSession("sess_2")
      ]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async () => ({ affectedSessionIds: ["sess_1"], ok: true, summary: "已提交图片生成任务。" }),
      executePackagePreflightTool: async () => ({ affectedSessionIds: ["sess_1"], ok: true, summary: "已打包生成图。" }),
      initialSnapshot: persisted,
      requestPermission: async (request) => {
        permissionRequests.push(request);
        return { decision: "allow" };
      },
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("list_sessions")?.execute("call-read", {});
    await tools.get("delete_session")?.execute("call-delete", { sessionId: "sess_2" });
    await tools.get("generate_image")?.execute("call-generate", {
      mode: "edit",
      prompt: "保留主体，换成白底主图",
      target: { sessionId: "sess_1", type: "existing" }
    });

    expect(permissionRequests.map((request) => request.toolName)).toEqual(["delete_session", "generate_image"]);
    expect(permissionRequests[0]).toMatchObject({ requiresPreflight: false, risk: "destructive" });
    expect(permissionRequests[1]).toMatchObject({ requiresPreflight: true, risk: "safe-write" });
    expect(preflightPayloads).toHaveLength(1);
    expect(persisted.sessions.map((session) => session.id)).toEqual(["sess_1"]);
  });

  test("stops a denied workspace permission before mutating or preflighting", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    let persisted = createSnapshot();
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async () => ({ affectedSessionIds: ["sess_1"], ok: true, summary: "should not execute" }),
      initialSnapshot: persisted,
      requestPermission: async () => ({ decision: "deny", reason: "策略暂不允许这个动作", suggestedNext: "请让用户确认后再试。" }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("generate_image")?.execute("call-1", {
      mode: "edit",
      prompt: "保留主体，换成白底主图",
      target: { sessionId: "sess_1", type: "existing" }
    });

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("Reason: permission denied.");
    expect(result?.content[0]?.text).toContain("策略暂不允许这个动作");
    expect(preflightPayloads).toEqual([]);
    expect(persisted).toEqual(createSnapshot());
  });

  test("rejects unsafe reorder parameters without partial persistence", async () => {
    let persisted = createSnapshot({
      sessions: [createSession("sess_1"), createSession("sess_2")]
    });
    const original = persisted;
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("reorder_sessions")?.execute("call-1", { sessionIds: ["sess_2"] });

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("Reason: sessionIds must be a full permutation.");
    expect(persisted).toBe(original);
  });

  test("scans and deletes unreferenced generated files through candidate ids only", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-esse-tools-"));
    const generatedDirectory = path.join(projectDirectory, "images", "generated");
    await mkdir(generatedDirectory, { recursive: true });
    const referencedPath = path.join(generatedDirectory, "referenced.png");
    const orphanPath = path.join(generatedDirectory, "orphan.png");
    await writeFile(referencedPath, "referenced");
    await writeFile(orphanPath, "orphan");

    let persisted = createSnapshot({
      project: {
        createdAt: "2026-05-24T00:00:00.000Z",
        directory: projectDirectory,
        id: "project_1",
        imageCount: 1,
        name: "测试项目",
        updatedAt: "2026-05-24T00:00:00.000Z"
      },
      sessions: [
        createSession("sess_1", {
          generatedFilePath: referencedPath,
          generatedFilePaths: [referencedPath]
        })
      ]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const scanResult = await tools.get("scan_unreferenced_files")?.execute("call-1", {});
    const candidates = scanResult?.details?.candidates as Array<{ candidateId: string; fileName: string }>;
    expect(candidates).toEqual([expect.objectContaining({ fileName: "orphan.png" })]);
    expect(JSON.stringify(scanResult?.details)).not.toContain(orphanPath);
    expect(scanResult?.content[0]?.text).toContain(candidates[0].candidateId);
    expect(scanResult?.content[0]?.text).toContain("orphan.png");
    expect(scanResult?.content[0]?.text).not.toContain(orphanPath);

    const deleteResult = await tools.get("delete_unreferenced_files")?.execute("call-2", {
      candidateIds: [candidates[0].candidateId]
    });

    expect(deleteResult?.content[0]?.text).toBe("已删除 1 个未引用生成文件。");
    await expect(readFile(orphanPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(referencedPath, "utf8")).resolves.toBe("referenced");
  });

  test("reads image metadata by session reference without exposing file paths", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-esse-metadata-"));
    const originalDirectory = path.join(projectDirectory, "images", "original");
    await mkdir(originalDirectory, { recursive: true });
    const imagePath = path.join(originalDirectory, "metadata.png");
    await sharp({
      create: {
        background: "#ffffff",
        channels: 3,
        height: 18,
        width: 32
      }
    })
      .png()
      .toFile(imagePath);

    const snapshot = createSnapshot({
      project: {
        createdAt: "2026-05-24T00:00:00.000Z",
        directory: projectDirectory,
        id: "project_1",
        imageCount: 1,
        name: "测试项目",
        updatedAt: "2026-05-24T00:00:00.000Z"
      },
      sessions: [createSession("sess_1", { filePath: imagePath })]
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: snapshot, sink: createNoopSink() });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("read_image_metadata")?.execute("call-1", {
      sessionId: "sess_1"
    });

    expect(result?.isError).toBeUndefined();
    expect(result?.content[0]?.text).toContain("width=32");
    expect(result?.content[0]?.text).toContain("height=18");
    expect(result?.content[0]?.text).toContain("format=png");
    expect(JSON.stringify(result)).not.toContain(imagePath);
  });

  test("adds a blank session without image API preflight", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-esse-blank-"));
    let persisted = createSnapshot({
      project: {
        createdAt: "2026-05-24T00:00:00.000Z",
        directory: projectDirectory,
        id: "project_1",
        imageCount: 1,
        name: "测试项目",
        updatedAt: "2026-05-24T00:00:00.000Z"
      }
    });
    const preflightPayloads: EssePreflightPayload[] = [];
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({
      initialSnapshot: persisted,
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("add_blank_session")?.execute("call-1", {
      fileName: "idea-slot.png"
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads).toEqual([]);
    expect(persisted.sessions).toHaveLength(2);
    expect(persisted.sessions[1]?.fileName).toBe("idea-slot.png");
    expect(persisted.selectedSessionId).toBe(persisted.sessions[1]?.id);
    expect(persisted.project.imageCount).toBe(2);
    await expect(sharp(persisted.sessions[1]?.filePath).metadata()).resolves.toMatchObject({
      format: "png",
      height: 1024,
      width: 1536
    });
  });

  test("requires preflight before executing a single image generation tool", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const executions: EsseImagePreflightExecutionRequest[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async (request) => {
        executions.push(request);
        return { affectedSessionIds: ["sess_1"], ok: true, summary: "已提交 1 个图片生成任务。" };
      },
      initialSnapshot: createSnapshot(),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("generate_image")?.execute("call-1", {
      mode: "edit",
      prompt: "保留主体，换成白底主图",
      target: { sessionId: "sess_1", type: "existing" }
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads).toEqual([
      {
        commands: [
          {
            displayLabel: "img-1",
            mode: "edit",
            prompt: "保留主体，换成白底主图",
            target: { sessionId: "sess_1", type: "existing" }
          }
        ],
        estimatedApiCalls: 1,
        tool: "generate_image"
      }
    ]);
    expect(JSON.stringify(preflightPayloads)).not.toContain('"size"');
    expect(executions).toHaveLength(1);
  });

  test("returns a do-not-retry error when the user cancels image preflight", async () => {
    let executed = false;
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async () => {
        executed = true;
        return { affectedSessionIds: [], ok: true, summary: "should not execute" };
      },
      initialSnapshot: createSnapshot(),
      requestPreflight: async () => ({ decision: "cancel", detail: "用户觉得成本太高" }),
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("generate_image")?.execute("call-1", {
      mode: "edit",
      prompt: "保留主体，换成白底主图",
      target: { sessionId: "sess_1", type: "existing" }
    });

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("Reason: User canceled preflight.");
    expect(result?.content[0]?.text).toContain("do NOT retry");
    expect(executed).toBe(false);
  });

  test("preflights batch generation with explicit command modes and explicit sizes only", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async (request) => ({ affectedSessionIds: request.commands.flatMap((command) => command.target.sessionId ?? []), ok: true, summary: "已提交批量生成任务。" }),
      initialSnapshot: createSnapshot({ sessions: [createSession("sess_1"), createSession("sess_2")] }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("run_batch_generation")?.execute("call-1", {
      commands: [
        { mode: "edit", prompt: "第一张换白底", target: { sessionId: "sess_1", type: "existing" } },
        { mode: "generate", prompt: "新增一张场景图", size: "2048x1152", target: { fileName: "scene.png", type: "new" } }
      ]
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads[0]).toMatchObject({
      estimatedApiCalls: 2,
      tool: "run_batch_generation"
    });
    expect(preflightPayloads[0].commands[0]).not.toHaveProperty("size");
    expect(preflightPayloads[0].commands[1]).toMatchObject({ mode: "generate", size: "2048x1152", target: { fileName: "scene.png", type: "new" } });
  });

  test("requires preflight before packaging generated images", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const packageRequests: unknown[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executePackagePreflightTool: async (request) => {
        packageRequests.push(request);
        return { affectedSessionIds: ["sess_1"], ok: true, summary: "已打包生成图。" };
      },
      initialSnapshot: createSnapshot({
        sessions: [
          createSession("sess_1", {
            generatedFilePaths: ["/project/generated/a.png"]
          })
        ]
      }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("package_generated_images")?.execute("call-1", {
      fileName: "esse.zip",
      sessionIds: ["sess_1"]
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads).toEqual([
      {
        commands: [
          {
            displayLabel: "img-1",
            prompt: "1 张生成图",
            target: { sessionId: "sess_1", type: "existing" }
          }
        ],
        estimatedApiCalls: 0,
        tool: "package_generated_images"
      }
    ]);
    expect(packageRequests).toEqual([{ fileName: "esse.zip", sessionIds: ["sess_1"], tool: "package_generated_images" }]);
  });

  test("does not package generated images when package preflight is canceled", async () => {
    let packaged = false;
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executePackagePreflightTool: async () => {
        packaged = true;
        return { affectedSessionIds: [], ok: true, summary: "should not package" };
      },
      initialSnapshot: createSnapshot({ sessions: [createSession("sess_1", { generatedFilePaths: ["/project/generated/a.png"] })] }),
      requestPreflight: async () => ({ decision: "cancel", detail: "用户取消打包" }),
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("package_generated_images")?.execute("call-1", {});

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("Reason: User canceled preflight.");
    expect(packaged).toBe(false);
  });

  test("rejects image preflight commands that would edit a new target", async () => {
    const runtime = createProjectSnapshotWorkspaceRuntime({
      initialSnapshot: createSnapshot(),
      requestPreflight: async () => ({ decision: "execute" }),
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("generate_image")?.execute("call-1", {
      mode: "edit",
      prompt: "编辑一张新图",
      target: { type: "new" }
    });

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("Reason: edit mode requires an existing target.");
  });
});

function toolsByName(tools: ReturnType<typeof createEsseWorkspaceTools>) {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function createNoopSink(): ProjectMutationSink<ProjectSnapshot> {
  return new ProjectMutationSink<ProjectSnapshot>({
    applyTransaction: async (mutator) => mutator(createSnapshot())
  });
}

function createSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-24T00:00:00.000Z",
      directory: "/project",
      id: "project_1",
      imageCount: 1,
      name: "测试项目",
      updatedAt: "2026-05-24T00:00:00.000Z"
    },
    selectedSessionId: "sess_1",
    sessions: [
      createSession("sess_1", {
        chatMessages: [
          {
            content: "已生成",
            generatedFilePath: "/project/generated/a-2.png",
            id: "msg_1",
            role: "assistant"
          }
        ],
        generatedFilePath: "/project/generated/a-2.png",
        generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png"]
      })
    ],
    ...overrides
  };
}

function createSession(id: string, overrides: Partial<ProjectSnapshot["sessions"][number]> = {}): ProjectSnapshot["sessions"][number] {
  return {
    chatMessages: [],
    chatStatus: "idle",
    fileName: `${id}.jpg`,
    filePath: `/project/original/${id}.jpg`,
    id,
    status: "idle",
    ...overrides
  };
}
