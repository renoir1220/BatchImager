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

  test("adds, lists, and removes project reference images from available local paths", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-reference-tools-"));
    const sourcePath = path.join(projectDirectory, "uploaded-style.png");
    const otherPath = path.join(projectDirectory, "bash-output.png");
    const textPath = path.join(projectDirectory, "uploaded-style.txt");
    await writeFile(sourcePath, "style");
    await writeFile(otherPath, "bash output");

    let persisted = createSnapshot({
      project: { ...createSnapshot().project, directory: projectDirectory },
      referenceImages: [
        {
          filePath: path.join(projectDirectory, "references", "existing.png"),
          id: "ref_existing",
          label: "已有参考"
        }
      ]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({
      getTurnReferenceImagePaths: () => [sourcePath, textPath],
      initialSnapshot: persisted,
      sink
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const listBefore = await tools.get("list_reference_images")?.execute("list-1", {});
    expect(listBefore?.content[0]?.text).toContain("ref_existing");

    const localOutput = await tools.get("add_reference_image")?.execute("add-local-output", {
      filePath: otherPath,
      fileName: "bash-output.png"
    });
    expect(localOutput?.isError).toBeUndefined();
    expect(persisted.referenceImages).toHaveLength(2);

    const unsupported = await tools.get("add_reference_image")?.execute("add-text", {
      filePath: textPath
    });
    expect(unsupported?.isError).toBe(true);

    const addResult = await tools.get("add_reference_image")?.execute("add-1", {
      fileName: "style.png",
      filePath: sourcePath
    });
    expect(addResult?.isError).toBeUndefined();
    expect(persisted.referenceImages).toHaveLength(3);
    const addedReference = persisted.referenceImages?.find((referenceImage) => referenceImage.label === "style.png");
    expect(addedReference).toMatchObject({ label: "style.png" });
    await expect(readFile(addedReference?.filePath ?? "")).resolves.toEqual(Buffer.from("style"));

    const removeResult = await tools.get("remove_reference_image")?.execute("remove-1", {
      referenceImageId: addedReference?.id
    });
    expect(removeResult?.isError).toBeUndefined();
    expect(persisted.referenceImages).toEqual([
      {
        filePath: path.join(projectDirectory, "references", "existing.png"),
        id: "ref_existing",
        label: "已有参考"
      },
      expect.objectContaining({ label: "bash-output.png" })
    ]);
    await expect(readFile(addedReference?.filePath ?? "")).rejects.toThrow();
  });

  test("adds an existing local image file to the left workspace", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-workspace-image-"));
    const sourcePath = path.join(projectDirectory, "ppt-export-page.png");
    await writeFile(sourcePath, "ppt page image");

    let persisted = createSnapshot({
      project: { ...createSnapshot().project, directory: projectDirectory, imageCount: 1 }
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const tools = toolsByName(createEsseWorkspaceTools(createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink })));

    const result = await tools.get("add_workspace_image")?.execute("add-workspace-image", {
      fileName: "第一页.png",
      filePath: sourcePath
    });

    expect(result?.isError).toBeUndefined();
    expect(result?.content[0]?.text).toContain("已添加图片到工作区：第一页.png");
    expect(persisted.sessions).toHaveLength(2);
    const addedSession = persisted.sessions.at(-1);
    expect(addedSession).toMatchObject({
      fileName: "第一页.png",
      status: "idle"
    });
    expect(addedSession?.filePath).toContain(path.join(projectDirectory, "images", "original"));
    await expect(readFile(addedSession?.filePath ?? "")).resolves.toEqual(Buffer.from("ppt page image"));
    expect(persisted.project.imageCount).toBe(2);
    expect(persisted.selectedSessionId).toBe(addedSession?.id);
  });

  test("does not expose duplicate generic project-file tools as workspace product tools", () => {
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: createSnapshot(), sink: createNoopSink() });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    expect(tools.has("read_project_file")).toBe(false);
    expect(tools.has("write_project_file")).toBe(false);
    expect(tools.has("append_project_file")).toBe(false);
  });

  test("adds multiple local image files to the left workspace in one tool call", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-workspace-images-"));
    const firstPath = path.join(projectDirectory, "ppt-page-01.png");
    const secondPath = path.join(projectDirectory, "ppt-page-02.png");
    await writeFile(firstPath, "ppt page 1");
    await writeFile(secondPath, "ppt page 2");

    let persisted = createSnapshot({
      project: { ...createSnapshot().project, directory: projectDirectory, imageCount: 1 }
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const tools = toolsByName(createEsseWorkspaceTools(createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink })));

    const result = await tools.get("add_workspace_image")?.execute("add-workspace-images", {
      images: [
        { fileName: "原PPT_第01页.png", filePath: firstPath },
        { fileName: "原PPT_第02页.png", filePath: secondPath }
      ]
    });

    expect(result?.isError).toBeUndefined();
    expect(result?.content[0]?.text).toContain("已添加 2 张图片到工作区");
    expect(result?.details?.affectedSessionIds).toHaveLength(2);
    expect(persisted.sessions).toHaveLength(3);
    const addedSessions = persisted.sessions.slice(-2);
    expect(addedSessions.map((session) => session.fileName)).toEqual(["原PPT_第01页.png", "原PPT_第02页.png"]);
    await expect(readFile(addedSessions[0]?.filePath ?? "")).resolves.toEqual(Buffer.from("ppt page 1"));
    await expect(readFile(addedSessions[1]?.filePath ?? "")).resolves.toEqual(Buffer.from("ppt page 2"));
    expect(persisted.project.imageCount).toBe(3);
    expect(persisted.selectedSessionId).toBe(addedSessions[1]?.id);
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

  test("records reversible mutations and undoes them in reverse order", async () => {
    let persisted = createSnapshot({
      selectedSessionId: "sess_1",
      sessions: [createSession("sess_1"), createSession("sess_2")]
    });
    const initialWorkspace = stripUndoLog(persisted);
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("rename_session")?.execute("rename", { fileName: "renamed.jpg", sessionId: "sess_1" });
    await tools.get("reorder_sessions")?.execute("reorder", { sessionIds: ["sess_2", "sess_1"] });
    expect(persisted.esseUndoLog).toHaveLength(2);
    expect(persisted.sessions.map((session) => session.id)).toEqual(["sess_2", "sess_1"]);

    const undoResult = await tools.get("undo_last_actions")?.execute("undo", { count: 2 });

    expect(undoResult?.isError).toBeUndefined();
    expect(stripUndoLog(persisted)).toEqual(initialWorkspace);
    expect(persisted.esseUndoLog?.every((entry) => entry.undone)).toBe(true);
  });

  test("undo warns when another workspace write happened after the reversible action", async () => {
    let persisted = createSnapshot({
      sessions: [createSession("sess_1"), createSession("sess_manual")]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("rename_session")?.execute("rename", { fileName: "renamed.jpg", sessionId: "sess_1" });
    expect(persisted.esseUndoLog?.[0]?.sinkRevisionAfter).toBe(1);
    await sink.apply((state) => ({
      ...state,
      sessions: state.sessions.filter((session) => session.id !== "sess_manual")
    }));
    expect(sink.getRevision()).toBe(2);

    const undoResult = await tools.get("undo_last_actions")?.execute("undo", {});

    expect(undoResult?.isError).toBeUndefined();
    expect(undoResult?.content[0]?.text).toContain("⚠️");
    expect(undoResult?.content[0]?.text).toContain("1 个中间工作区写入");
    expect(persisted.sessions.map((session) => session.id)).toEqual(["sess_1", "sess_manual"]);
  });

  test("undo does not warn for consecutive Esse reversible writes", async () => {
    let persisted = createSnapshot({
      sessions: [createSession("sess_1"), createSession("sess_2")]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("rename_session")?.execute("rename", { fileName: "renamed.jpg", sessionId: "sess_1" });
    await tools.get("reorder_sessions")?.execute("reorder", { sessionIds: ["sess_2", "sess_1"] });
    const undoResult = await tools.get("undo_last_actions")?.execute("undo", { count: 2 });

    expect(undoResult?.isError).toBeUndefined();
    expect(undoResult?.content[0]?.text).not.toContain("⚠️");
  });

  test("undo restores deleted records and deleted sessions", async () => {
    let persisted = createSnapshot({
      sessions: [
        createSession("sess_1", {
          generatedFilePath: "/project/generated/a-2.png",
          generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png"]
        }),
        createSession("sess_2")
      ]
    });
    const initialWorkspace = stripUndoLog(persisted);
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("delete_session_record")?.execute("delete-record", { recordIndex: 2, sessionId: "sess_1" });
    await tools.get("delete_session")?.execute("delete-session", { sessionId: "sess_2" });
    await tools.get("undo_last_actions")?.execute("undo", { count: 2 });

    expect(stripUndoLog(persisted)).toEqual(initialWorkspace);
  });

  test("splits generated records into a new session and undo restores the source", async () => {
    let persisted = createSnapshot({
      sessions: [
        createSession("sess_1", {
          chatMessages: [
            { content: "记录 2", generatedFilePath: "/project/generated/a-2.png", id: "msg_1", role: "assistant" }
          ],
          generatedFilePath: "/project/generated/a-2.png",
          generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png", "/project/generated/a-3.png"]
        })
      ]
    });
    const initialWorkspace = stripUndoLog(persisted);
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const splitResult = await tools.get("split_session")?.execute("split", {
      fileName: "拆分记录.jpg",
      recordIndexes: [2, 3],
      sessionId: "sess_1"
    });

    expect(splitResult?.isError).toBeUndefined();
    expect(persisted.sessions).toHaveLength(2);
    expect(persisted.sessions[0]).toMatchObject({
      generatedFilePath: "/project/generated/a-1.png",
      generatedFilePaths: ["/project/generated/a-1.png"]
    });
    expect(persisted.sessions[0]?.chatMessages[0]?.generatedFilePath).toBeUndefined();
    expect(persisted.sessions[1]).toMatchObject({
      fileName: "拆分记录.jpg",
      filePath: "/project/generated/a-2.png",
      generatedFilePath: "/project/generated/a-2.png",
      generatedFilePaths: ["/project/generated/a-2.png", "/project/generated/a-3.png"],
      originatedFromGeneration: true,
      status: "completed"
    });

    await tools.get("undo_last_actions")?.execute("undo-split", {});
    expect(stripUndoLog(persisted)).toEqual(initialWorkspace);
  });

  test("rejects invalid split record indexes and splitting all records", async () => {
    let persisted = createSnapshot({
      sessions: [
        createSession("sess_1", {
          generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png"]
        })
      ]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const tools = toolsByName(createEsseWorkspaceTools(createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink })));

    const outOfRange = await tools.get("split_session")?.execute("split-bad-index", {
      recordIndexes: [3],
      sessionId: "sess_1"
    });
    const allRecords = await tools.get("split_session")?.execute("split-all", {
      recordIndexes: [1, 2],
      sessionId: "sess_1"
    });

    expect(outOfRange?.isError).toBe(true);
    expect(outOfRange?.content[0]?.text).toContain("recordIndex out of range");
    expect(allRecords?.isError).toBe(true);
    expect(allRecords?.content[0]?.text).toContain("cannot split all records");
    expect(persisted.sessions).toHaveLength(1);
  });

  test("duplicates sessions without copying chat history and undo removes the duplicate", async () => {
    let persisted = createSnapshot({
      sessions: [
        createSession("sess_1", {
          chatMessages: [{ content: "原会话", id: "msg_1", role: "assistant" }],
          generatedFilePath: "/project/generated/a-2.png",
          generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png"],
          lastPrompt: "白底图",
          originatedFromGeneration: true,
          showOriginalInList: false
        })
      ]
    });
    const initialWorkspace = stripUndoLog(persisted);
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const tools = toolsByName(createEsseWorkspaceTools(createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink })));

    const duplicateResult = await tools.get("duplicate_session")?.execute("duplicate", {
      fileName: "对比副本.jpg",
      sessionId: "sess_1"
    });

    expect(duplicateResult?.isError).toBeUndefined();
    expect(persisted.sessions).toHaveLength(2);
    const duplicate = persisted.sessions[1];
    expect(duplicate?.id).not.toBe("sess_1");
    expect(duplicateResult?.content[0]?.text).toContain(`sessionId=${duplicate?.id}`);
    expect(duplicateResult?.content[0]?.text).toContain("新副本是 img-2");
    expect(duplicateResult?.details?.affectedSessionIds).toEqual(["sess_1", duplicate?.id]);
    expect(duplicate).toMatchObject({
      chatMessages: [],
      fileName: "对比副本.jpg",
      filePath: "/project/original/sess_1.jpg",
      generatedFilePath: "/project/generated/a-2.png",
      generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png"],
      lastPrompt: "白底图",
      originatedFromGeneration: true,
      status: "completed"
    });
    expect(persisted.selectedSessionId).toBe(duplicate?.id);

    await tools.get("undo_last_actions")?.execute("undo-duplicate", {});
    expect(stripUndoLog(persisted)).toEqual(initialWorkspace);
  });

  test("keeps only the latest fifty undo entries", async () => {
    let persisted = createSnapshot();
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot: persisted, sink });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    for (let index = 0; index < 55; index += 1) {
      await tools.get("rename_session")?.execute(`rename-${index}`, { fileName: `name-${index}.jpg`, sessionId: "sess_1" });
    }

    expect(persisted.esseUndoLog).toHaveLength(50);
    expect(persisted.esseUndoLog?.[0]?.summary).toBe("已重命名为 name-5.jpg。");
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
      content: expect.stringContaining("智能体工具调用：list_sessions（完成）"),
      contextType: "agent-tool-call",
      role: "context"
    });
    expect(messages[1]).toMatchObject({
      content: expect.stringContaining("智能体工具调用：delete_session_record（完成）"),
      contextType: "agent-tool-call",
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
    expect(listResult?.content[0]?.text).toContain("img-1; id=sess_1; referenceImageId=workspace-ref-sess_1");
    expect(recordResult?.details?.records).toEqual([
      { fileName: "a-1.png", isCurrent: false, recordIndex: 1 },
      { fileName: "a-2.png", isCurrent: true, recordIndex: 2 }
    ]);
    expect(recordResult?.content[0]?.text).toContain("sessionId=sess_1");
    expect(recordResult?.content[0]?.text).toContain("recordIndex=1");
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
    expect(toolsByName(tools).get("add_workspace_image")?.description).toContain("one call with images");
    expect(toolsByName(tools).get("generate_image")).toMatchObject({ risk: "safe-write", requiresPreflight: true });
    expect(toolsByName(tools).get("generate_image")?.description).toContain("BatchImager project image API");
    expect(toolsByName(tools).get("run_batch_generation")?.description).toContain("at most 10 commands");
    expect(toolsByName(tools).get("package_generated_images")).toMatchObject({
      risk: "safe-write",
      requiresPreflight: true
    });
  });

  test("package uses preflight without an external-write permission card while reference add still asks", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-package-permission-"));
    const turnReferencePath = path.join(projectDirectory, "style.png");
    await writeFile(turnReferencePath, "not-a-real-image-but-extension-is-supported");
    const permissionRequests: EsseWorkspacePermissionRequest[] = [];
    const preflightPayloads: EssePreflightPayload[] = [];
    let persisted = createSnapshot({
      project: {
        createdAt: "2026-05-24T00:00:00.000Z",
        directory: projectDirectory,
        id: "project_1",
        imageCount: 1,
        name: "权限评估项目",
        updatedAt: "2026-05-24T00:00:00.000Z"
      },
      sessions: [
        createSession("sess_1", {
          generatedFilePaths: ["/project/generated/a.png"]
        })
      ]
    });
    const sink = new ProjectMutationSink<ProjectSnapshot>({
      applyTransaction: async (mutator) => {
        persisted = mutator(persisted);
        return persisted;
      }
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executePackagePreflightTool: async () => ({ affectedSessionIds: ["sess_1"], ok: true, summary: "已打包生成图。" }),
      initialSnapshot: persisted,
      getTurnReferenceImagePaths: () => [turnReferencePath],
      requestPermission: async (request) => {
        if (request.risk !== "safe-write") {
          permissionRequests.push(request);
        }
        return { decision: "allow" };
      },
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    await tools.get("package_generated_images")?.execute("package", {});
    await tools.get("add_reference_image")?.execute("add-reference", { filePath: turnReferencePath });

    expect(preflightPayloads).toHaveLength(1);
    expect(preflightPayloads[0]?.tool).toBe("package_generated_images");
    expect(permissionRequests.map((request) => request.toolName)).toEqual(["add_reference_image"]);
    expect(permissionRequests[0]).toMatchObject({ risk: "external-write" });
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
            target: { sourceSessionId: "sess_1", type: "new" }
          }
        ],
        estimatedApiCalls: 1,
        tool: "generate_image"
      }
    ]);
    expect(JSON.stringify(preflightPayloads)).not.toContain('"size"');
    expect(executions).toHaveLength(1);
    expect(runtime.getState().esseUndoLog).toBeUndefined();
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

  test("executes modified preflight commands without another model turn", async () => {
    const executions: EsseImagePreflightExecutionRequest[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async (request) => {
        executions.push(request);
        return { affectedSessionIds: ["sess_1"], ok: true, summary: "已按修改提交生成任务。" };
      },
      initialSnapshot: createSnapshot(),
      requestPreflight: async (payload) => ({
        decision: "modify",
        modifiedCommands: [
          {
            ...payload.commands[0],
            mode: "edit",
            prompt: "用户修改后的浅灰场景图"
          }
        ]
      }),
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("generate_image")?.execute("call-1", {
      mode: "edit",
      prompt: "模型原始白底主图",
      target: { sessionId: "sess_1", type: "existing" }
    });

    expect(result?.isError).toBeUndefined();
    expect(executions).toHaveLength(1);
    expect(executions[0].commands[0]).toMatchObject({
      mode: "edit",
      prompt: "用户修改后的浅灰场景图",
      target: { sourceSessionId: "sess_1", type: "new" }
    });
  });

  test("rejects modified preflight commands that change command count", async () => {
    let executed = false;
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async () => {
        executed = true;
        return { affectedSessionIds: ["sess_1"], ok: true, summary: "should not execute" };
      },
      initialSnapshot: createSnapshot(),
      requestPreflight: async () => ({ decision: "modify", modifiedCommands: [] }),
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("generate_image")?.execute("call-1", {
      mode: "edit",
      prompt: "模型原始白底主图",
      target: { sessionId: "sess_1", type: "existing" }
    });

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("invalid modified preflight commands");
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

  test("describes generation preflight tools as UI-blocking confirmation cards before execution", () => {
    const tools = toolsByName(createEsseWorkspaceTools(createProjectSnapshotWorkspaceRuntime({
      initialSnapshot: createSnapshot(),
      sink: createNoopSink()
    })));

    expect(tools.get("generate_image")?.description).toContain("the UI will show a confirmation card and this turn will wait");
    expect(tools.get("run_batch_generation")?.description).toContain("the UI will show a confirmation card and this turn will wait");
    expect(tools.get("package_generated_images")?.description).toContain("the UI will show a confirmation card and this turn will wait");
  });

  test("includes explicit workspace references in image preflight payloads", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async (request) => ({ affectedSessionIds: request.commands.flatMap((command) => command.target.sessionId ?? []), ok: true, summary: "已提交批量生成任务。" }),
      initialSnapshot: createSnapshot({ sessions: [createSession("sess_1"), createSession("sess_2", { fileName: "scene.jpg", filePath: "/project/original/scene.jpg" })] }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("run_batch_generation")?.execute("call-1", {
      commands: [
        {
          mode: "edit",
          prompt: "用图2场景重做",
          referenceImageIds: ["workspace-ref-sess_2"],
          target: { sessionId: "sess_1", type: "existing" }
        }
      ]
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads[0]?.referenceImages).toEqual([
      {
        filePath: "/project/original/scene.jpg",
        id: "workspace-ref-sess_2",
        label: "图2 scene.jpg"
      }
    ]);
  });

  test("exposes conversation reference candidates for Esse-controlled reuse", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async () => ({ affectedSessionIds: [], ok: true, summary: "已提交生成任务。" }),
      initialSnapshot: createSnapshot({
        projectManagerState: {
          conversation: {
            id: "conv_1",
            messages: [
              {
                content: "用这张参考图先出一版",
                id: "user-1",
                referenceFilePaths: ["/project/uploads/style.png"],
                role: "user"
              }
            ]
          },
          plans: []
        }
      }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const listResult = await tools.get("list_reference_images")?.execute("list-refs", {});
    expect(listResult?.content[0]?.text).toContain("id=conversation-ref-1");

    const result = await tools.get("generate_image")?.execute("call-1", {
      mode: "generate",
      prompt: "沿用对话里的参考风格生成新图",
      referenceImageIds: ["conversation-ref-1"],
      target: { fileName: "from-conversation-reference.png", type: "new" }
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads[0]?.referenceImages).toEqual([
      {
        filePath: "/project/uploads/style.png",
        id: "conversation-ref-1",
        label: "对话参考图 1"
      }
    ]);
  });

  test("includes reference previews from previous submitted batch tasks in new preflight payloads", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async (request) => ({ affectedSessionIds: request.commands.flatMap((command) => command.target.sessionId ?? []), ok: true, summary: "已提交批量生成任务。" }),
      initialSnapshot: createSnapshot({
        projectManagerState: {
          conversation: {
            id: "conv_1",
            messages: [
              {
                batchTask: {
                  batchTaskId: "batch_1",
                  items: [],
                  referenceImages: [
                    { filePath: "/project/clicked/scene.png", id: "turn-ref-5", label: "本轮参考图 5" },
                    { filePath: "/project/clicked/plant-a.png", id: "turn-ref-1", label: "本轮参考图 1" },
                    { filePath: "/project/clicked/scale.png", id: "turn-ref-4", label: "本轮参考图 4" }
                  ]
                },
                content: "",
                contextType: "agent-batch-task",
                id: "msg_batch",
                role: "context"
              }
            ]
          },
          plans: []
        }
      }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("run_batch_generation")?.execute("call-1", {
      commands: [
        {
          mode: "generate",
          prompt: "以场景图为基础，把目标植物自然替换进去，并按大小参考控制尺度。",
          referenceImageIds: ["turn-ref-5", "turn-ref-1", "turn-ref-4"],
          referenceImageNames: ["场景图", "目标植物", "大小参考"],
          target: { fileName: "scene-result.png", type: "new" }
        }
      ]
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads[0]?.referenceImages).toEqual([
      { filePath: "/project/clicked/scene.png", id: "turn-ref-5", label: "本轮参考图 5" },
      { filePath: "/project/clicked/plant-a.png", id: "turn-ref-1", label: "本轮参考图 1" },
      { filePath: "/project/clicked/scale.png", id: "turn-ref-4", label: "本轮参考图 4" }
    ]);
  });

  test("normalizes missing names and accepts recoverable prompt labels for multi-image generation prompts", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async () => ({ affectedSessionIds: [], ok: true, summary: "已提交批量生成任务。" }),
      initialSnapshot: createSnapshot({
        sessions: [
          createSession("sess_1", { fileName: "scene.jpg", filePath: "/project/original/scene.jpg" }),
          createSession("sess_2", { fileName: "plant.jpg", filePath: "/project/original/plant.jpg" })
        ]
      }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const missingNames = await tools.get("generate_image")?.execute("call-missing-names", {
      mode: "generate",
      prompt: "把植物放进场景",
      referenceImageIds: ["workspace-ref-sess_1", "workspace-ref-sess_2"],
      target: { fileName: "scene-result.png", type: "new" }
    });
    expect(missingNames?.isError).toBeUndefined();
    expect(preflightPayloads[0]?.commands[0]).toMatchObject({
      referenceImageIds: ["workspace-ref-sess_1", "workspace-ref-sess_2"],
      referenceImageNames: ["参考图1", "参考图2"]
    });

    const uiLabelsInPrompt = await tools.get("generate_image")?.execute("call-ui-labels", {
      mode: "generate",
      prompt: "把【图片2】放进【图片1】场景",
      referenceImageIds: ["workspace-ref-sess_1", "workspace-ref-sess_2"],
      referenceImageNames: ["场景图", "目标植物"],
      target: { fileName: "scene-result.png", type: "new" }
    });
    expect(uiLabelsInPrompt?.isError).toBeUndefined();
    expect(preflightPayloads[1]?.commands[0]).toMatchObject({
      prompt: "把【图片2】放进【图片1】场景",
      referenceImageNames: ["场景图", "目标植物"]
    });

    const result = await tools.get("generate_image")?.execute("call-ok", {
      mode: "generate",
      prompt: "以场景图为待保留场景，将目标植物自然替换进去。",
      referenceImageIds: ["workspace-ref-sess_1", "workspace-ref-sess_2"],
      referenceImageNames: ["场景图", "目标植物"],
      target: { fileName: "scene-result.png", type: "new" }
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads[2]?.commands[0]).toMatchObject({
      prompt: "以场景图为待保留场景，将目标植物自然替换进去。",
      referenceImageIds: ["workspace-ref-sess_1", "workspace-ref-sess_2"],
      referenceImageNames: ["场景图", "目标植物"]
    });
  });

  test("preflights new images based on existing sessions without requiring duplicate_session first", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const executionRequests: unknown[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async (request) => {
        executionRequests.push(request);
        return { affectedSessionIds: [], ok: true, summary: "已提交批量生成任务。" };
      },
      initialSnapshot: createSnapshot({ sessions: [createSession("sess_1")] }),
      requestPreflight: async (payload) => {
        preflightPayloads.push(payload);
        return { decision: "execute" };
      },
      sink: createNoopSink()
    });
    const tools = toolsByName(createEsseWorkspaceTools(runtime));

    const result = await tools.get("run_batch_generation")?.execute("call-1", {
      commands: [
        {
          mode: "edit",
          prompt: "基于图1生成一张新商品图，保留原图不动",
          target: { fileName: "new-from-img-1.jpg", sourceSessionId: "sess_1", type: "new" }
        }
      ]
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads[0]?.commands).toEqual([
      {
        displayLabel: "img-1",
        mode: "edit",
        prompt: "基于图1生成一张新商品图，保留原图不动",
        target: { fileName: "new-from-img-1.jpg", sourceSessionId: "sess_1", type: "new" }
      }
    ]);
    expect(executionRequests).toEqual([
      {
        commands: preflightPayloads[0]?.commands,
        tool: "run_batch_generation"
      }
    ]);
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

  test("rejects image preflight commands that would edit a new target without any input image", async () => {
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
    expect(result?.content[0]?.text).toContain("Reason: edit mode with a new target requires sourceSessionId or referenceImageIds.");
  });

  test("allows edit mode with a new target when clicked references provide the input", async () => {
    const preflightPayloads: EssePreflightPayload[] = [];
    const executionRequests: unknown[] = [];
    const runtime = createProjectSnapshotWorkspaceRuntime({
      executeImagePreflightTool: async (request) => {
        executionRequests.push(request);
        return { affectedSessionIds: [], ok: true, summary: "已提交生成任务。" };
      },
      getTurnReferenceImagePaths: () => ["/project/clicked/reference.png"],
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
      prompt: "按本轮图片生成一个新的商品图",
      referenceImageIds: ["turn-ref-1"],
      target: { fileName: "new-from-reference.png", type: "new" }
    });

    expect(result?.isError).toBeUndefined();
    expect(preflightPayloads[0]?.commands[0]).toMatchObject({
      mode: "edit",
      referenceImageIds: ["turn-ref-1"],
      target: { fileName: "new-from-reference.png", type: "new" }
    });
    expect(executionRequests[0]).toMatchObject({
      commands: [
        expect.objectContaining({
          referenceImageIds: ["turn-ref-1"],
          target: { fileName: "new-from-reference.png", type: "new" }
        })
      ],
      tool: "generate_image"
    });
  });

  test("treats generation-originated sessions as generated primaries", async () => {
    let persisted = createSnapshot({
      sessions: [
        createSession("sess_generated", {
          filePath: "/project/generated/primary.png",
          generatedFilePath: "/project/generated/second.png",
          generatedFilePaths: ["/project/generated/primary.png", "/project/generated/second.png"],
          originatedFromGeneration: true,
          showOriginalInList: true
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

    const listResult = await tools.get("list_sessions")?.execute("list", {});
    const recordsResult = await tools.get("get_session_records")?.execute("records", { sessionId: "sess_generated" });
    const restoreResult = await tools.get("restore_original")?.execute("restore", { sessionId: "sess_generated" });

    expect(listResult?.details?.sessions).toEqual([
      expect.objectContaining({ currentImageSource: "generated", id: "sess_generated", referenceImageId: "workspace-ref-sess_generated" })
    ]);
    expect(recordsResult?.details?.records).toEqual([
      expect.objectContaining({ isPrimary: true, recordIndex: 1 }),
      expect.objectContaining({ recordIndex: 2 })
    ]);
    expect(restoreResult?.isError).toBeUndefined();
    expect(persisted.sessions[0]).toMatchObject({
      generatedFilePath: "/project/generated/primary.png",
      showOriginalInList: false
    });
  });

  test("deleting the only record of a generation-originated session removes the session", async () => {
    let persisted = createSnapshot({
      selectedSessionId: "sess_generated",
      sessions: [
        createSession("sess_generated", {
          filePath: "/project/generated/primary.png",
          generatedFilePath: "/project/generated/primary.png",
          generatedFilePaths: ["/project/generated/primary.png"],
          originatedFromGeneration: true
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

    const result = await tools.get("delete_session_record")?.execute("delete", {
      recordIndex: 1,
      sessionId: "sess_generated"
    });

    expect(result?.isError).toBeUndefined();
    expect(persisted.sessions).toEqual([]);
    expect(persisted.project.imageCount).toBe(0);
    expect(persisted.selectedSessionId).toBeNull();
  });
});

function toolsByName(tools: ReturnType<typeof createEsseWorkspaceTools>) {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function stripUndoLog(snapshot: ProjectSnapshot): ProjectSnapshot {
  const { esseUndoLog: _esseUndoLog, ...rest } = snapshot;
  return rest;
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
