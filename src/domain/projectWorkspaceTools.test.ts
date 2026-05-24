import { describe, expect, test } from "vitest";
import type { ImageSession } from "../types/image";
import type { ProjectState, ProjectMutationResult } from "./projectMutations";
import { createProjectWorkspaceTools, type ProjectWorkspaceToolRuntime } from "./projectWorkspaceTools";

describe("projectWorkspaceTools", () => {
  test("lists stable session ids with display labels for user-facing references", () => {
    const runtime = createRuntime(makeState([makeSession("sess_a"), makeSession("sess_b")], "sess_b"));
    const tools = indexTools(createProjectWorkspaceTools(runtime));

    const result = tools.list_sessions.execute({});

    expect(result.isError).toBeUndefined();
    expect(result.details?.sessions).toEqual([
      expect.objectContaining({ displayLabel: "img-1", id: "sess_a", isSelected: false }),
      expect.objectContaining({ displayLabel: "img-2", id: "sess_b", isSelected: true })
    ]);
  });

  test("gets session records before a destructive record operation", () => {
    const runtime = createRuntime(
      makeState([
        makeSession("sess_a", {
          generatedFilePath: "C:/generated/a-2.png",
          generatedFilePaths: ["C:/generated/a-1.png", "C:/generated/a-2.png"]
        })
      ])
    );
    const tools = indexTools(createProjectWorkspaceTools(runtime));

    const result = tools.get_session_records.execute({ sessionId: "sess_a" });

    expect(result.details?.records).toEqual([
      { fileName: "a-1.png", isCurrent: false, recordIndex: 1 },
      { fileName: "a-2.png", isCurrent: true, recordIndex: 2 }
    ]);
    expect(JSON.stringify(result.details)).not.toContain("C:/generated");
  });

  test("executes restore and delete record as sequential workspace tools", () => {
    const runtime = createRuntime(
      makeState([
        makeSession("sess_a", {
          generatedFilePath: "C:/generated/a-2.png",
          generatedFilePaths: ["C:/generated/a-1.png", "C:/generated/a-2.png"]
        })
      ])
    );
    const tools = indexTools(createProjectWorkspaceTools(runtime));

    const restored = tools.restore_session_record.execute({ sessionId: "sess_a", recordIndex: 1 });
    const deleted = tools.delete_session_record.execute({ sessionId: "sess_a", recordIndex: 2 });

    expect(restored.details?.affectedSessionIds).toEqual(["sess_a"]);
    expect(deleted.content[0]?.text).toBe("已删除记录 2。");
    expect(runtime.getState().sessions[0]).toMatchObject({
      generatedFilePath: "C:/generated/a-1.png",
      generatedFilePaths: ["C:/generated/a-1.png"]
    });
  });

  test("returns actionable structured error text when a tool cannot execute", () => {
    const runtime = createRuntime(makeState([makeSession("sess_a")]));
    const tools = indexTools(createProjectWorkspaceTools(runtime));

    const result = tools.restore_session_record.execute({ sessionId: "sess_a", recordIndex: 2 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Reason: recordIndex out of range.");
    expect(result.content[0]?.text).toContain("Suggested next: call get_session_records to verify.");
  });

  test("deletes and merges sessions through tool execution", () => {
    const runtime = createRuntime(
      makeState([
        makeSession("sess_target", { generatedFilePaths: ["C:/generated/target.png"] }),
        makeSession("sess_source", { generatedFilePaths: ["C:/generated/source.png"] }),
        makeSession("sess_delete")
      ], "sess_delete")
    );
    const tools = indexTools(createProjectWorkspaceTools(runtime));

    const deleted = tools.delete_session.execute({ sessionId: "sess_delete" });
    const merged = tools.merge_sessions.execute({ targetSessionId: "sess_target", sourceSessionIds: ["sess_source"] });

    expect(deleted.content[0]?.text).toBe("已删除图片。");
    expect(merged.content[0]?.text).toBe("已合并 1 张图片。");
    expect(runtime.getState().sessions.map((session) => session.id)).toEqual(["sess_target"]);
    expect(runtime.getState().selectedSessionId).toBe("sess_target");
    expect(runtime.getState().sessions[0].generatedFilePaths).toEqual(["C:/generated/target.png", "C:/generated/source.png"]);
  });

  test("renames, reorders sessions, restores original, and sets a prompt through safe-write tools", () => {
    const runtime = createRuntime(makeState([makeSession("sess_a"), makeSession("sess_b")]));
    const tools = indexTools(createProjectWorkspaceTools(runtime));

    tools.rename_session.execute({ sessionId: "sess_b", fileName: "hero-b.jpg" });
    tools.reorder_sessions.execute({ sessionIds: ["sess_b", "sess_a"] });
    tools.set_session_prompt.execute({ sessionId: "sess_b", prompt: "白底商品图" });
    tools.restore_original.execute({ sessionId: "sess_b" });

    expect(runtime.getState().sessions.map((session) => session.id)).toEqual(["sess_b", "sess_a"]);
    expect(runtime.getState().sessions[0].fileName).toBe("hero-b.jpg");
    expect(runtime.getState().sessions[0].lastPrompt).toBe("白底商品图");
    expect(runtime.getState().sessions[0].generatedFilePath).toBeUndefined();
  });
});

function indexTools(tools: ReturnType<typeof createProjectWorkspaceTools>) {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool])) as Record<string, ReturnType<typeof createProjectWorkspaceTools>[number]>;
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

function makeState(sessions: ImageSession[], selectedSessionId = sessions[0]?.id ?? null): ProjectState {
  return {
    project: { directory: "C:/project", name: "工具测试项目" },
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
