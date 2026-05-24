import { describe, expect, test } from "vitest";
import type { ImageSession } from "../types/image";
import type { ProjectManagerState } from "../types/projectManager";
import {
  applyAddBlankSession,
  applyAppendGeneratedRecord,
  applyDeleteRecord,
  applyDeleteSession,
  applyMergeSessions,
  applyRenameSession,
  applyReorderSessions,
  applyRestoreOriginal,
  applyRestoreRecord,
  applySetSessionPrompt,
  type ProjectState
} from "./projectMutations";

describe("projectMutations", () => {
  test("restores a generated record by 1-based recordIndex", () => {
    const state = makeProjectState([
      makeSession("sess_a", {
        generatedFilePath: "C:/generated/a-2.png",
        generatedFilePaths: ["C:/generated/a-1.png", "C:/generated/a-2.png"]
      })
    ]);

    const result = applyRestoreRecord(state, { sessionId: "sess_a", recordIndex: 1 });

    expect(result.result).toMatchObject({ ok: true, affectedSessionIds: ["sess_a"] });
    expect(result.state.sessions[0]).toMatchObject({
      generatedFilePath: "C:/generated/a-1.png",
      showOriginalInList: false
    });
  });

  test("keeps state unchanged when restore record index is out of range", () => {
    const state = makeProjectState([makeSession("sess_a", { generatedFilePaths: ["C:/generated/a-1.png"] })]);

    const result = applyRestoreRecord(state, { sessionId: "sess_a", recordIndex: 2 });

    expect(result.state).toBe(state);
    expect(result.result).toMatchObject({
      ok: false,
      reason: "recordIndex out of range",
      suggestedNext: "call get_session_records to verify."
    });
  });

  test("deletes the current record, falls back to the previous record, and clears chat image references", () => {
    const state = makeProjectState([
      makeSession("sess_a", {
        chatMessages: [
          { id: "m-1", role: "context", content: "生成完成", contextType: "generated-image", generatedFilePath: "C:/generated/a-1.png" },
          { id: "m-2", role: "context", content: "生成完成", contextType: "generated-image", generatedFilePath: "C:/generated/a-2.png" }
        ],
        generatedFilePath: "C:/generated/a-2.png",
        generatedFilePaths: ["C:/generated/a-1.png", "C:/generated/a-2.png", "C:/generated/a-3.png"]
      })
    ]);

    const result = applyDeleteRecord(state, { sessionId: "sess_a", recordIndex: 2 });

    expect(result.result).toMatchObject({ ok: true, affectedSessionIds: ["sess_a"] });
    expect(result.state.sessions[0]).toMatchObject({
      generatedFilePath: "C:/generated/a-1.png",
      generatedFilePaths: ["C:/generated/a-1.png", "C:/generated/a-3.png"],
      showOriginalInList: false
    });
    expect(result.state.sessions[0].chatMessages[1]).toEqual({
      id: "m-2",
      role: "context",
      content: "生成完成",
      contextType: "generated-image",
      generatedFilePath: undefined
    });
  });

  test("deleting the only generated record returns the session to original display", () => {
    const state = makeProjectState([
      makeSession("sess_a", {
        generatedFilePath: "C:/generated/a-1.png",
        generatedFilePaths: ["C:/generated/a-1.png"]
      })
    ]);

    const result = applyDeleteRecord(state, { sessionId: "sess_a", recordIndex: 1 });

    expect(result.state.sessions[0]).toMatchObject({
      generatedFilePath: undefined,
      generatedFilePaths: undefined,
      showOriginalInList: true
    });
  });

  test("deletes a session and selects the next available session", () => {
    const state = makeProjectState([makeSession("sess_a"), makeSession("sess_b"), makeSession("sess_c")], "sess_b");

    const result = applyDeleteSession(state, { sessionId: "sess_b" });

    expect(result.result).toMatchObject({ ok: true, affectedSessionIds: ["sess_b"] });
    expect(result.state.sessions.map((session) => session.id)).toEqual(["sess_a", "sess_c"]);
    expect(result.state.selectedSessionId).toBe("sess_c");
  });

  test("merges source session records and chat context into the target session", () => {
    const state = makeProjectState([
      makeSession("sess_target", {
        generatedFilePath: "C:/generated/target-1.png",
        generatedFilePaths: ["C:/generated/target-1.png"]
      }),
      makeSession("sess_source", {
        chatMessages: [{ id: "source-m", role: "context", content: "源记录", contextType: "generated-image", generatedFilePath: "C:/generated/source-1.png" }],
        generatedFilePath: "C:/generated/source-current.png",
        generatedFilePaths: ["C:/generated/source-1.png"]
      })
    ], "sess_source");

    const result = applyMergeSessions(state, { targetSessionId: "sess_target", sourceSessionIds: ["sess_source"] });

    expect(result.result).toMatchObject({ ok: true, affectedSessionIds: ["sess_target", "sess_source"] });
    expect(result.state.sessions.map((session) => session.id)).toEqual(["sess_target"]);
    expect(result.state.selectedSessionId).toBe("sess_target");
    expect(result.state.sessions[0].generatedFilePaths).toEqual([
      "C:/generated/target-1.png",
      "C:/generated/source-1.png",
      "C:/generated/source-current.png"
    ]);
    expect(result.state.sessions[0].chatMessages).toEqual([
      { id: "source-m", role: "context", content: "源记录", contextType: "generated-image", generatedFilePath: "C:/generated/source-1.png" }
    ]);
  });

  test("requires reorder input to be a full current id permutation", () => {
    const state = makeProjectState([makeSession("sess_a"), makeSession("sess_b")]);

    const failed = applyReorderSessions(state, { sessionIds: ["sess_b"] });
    const moved = applyReorderSessions(state, { sessionIds: ["sess_b", "sess_a"] });

    expect(failed.state).toBe(state);
    expect(failed.result).toMatchObject({ ok: false, reason: "sessionIds must be a full permutation" });
    expect(moved.state.sessions.map((session) => session.id)).toEqual(["sess_b", "sess_a"]);
  });

  test("updates small safe-write session fields", () => {
    const state = makeProjectState([makeSession("sess_a")]);

    const renamed = applyRenameSession(state, { sessionId: "sess_a", fileName: "商品主图.png" });
    const prompted = applySetSessionPrompt(renamed.state, { sessionId: "sess_a", prompt: "白底商品图" });
    const original = applyRestoreOriginal(
      {
        ...prompted.state,
        sessions: [
          {
            ...prompted.state.sessions[0],
            generatedFilePath: "C:/generated/a.png",
            generatedFilePaths: ["C:/generated/a.png"]
          }
        ]
      },
      { sessionId: "sess_a" }
    );

    expect(original.state.sessions[0]).toMatchObject({
      fileName: "商品主图.png",
      generatedFilePath: undefined,
      lastPrompt: "白底商品图",
      showOriginalInList: false
    });
  });

  test("adds a blank session only with an explicit stable id and placeholder path", () => {
    const state = makeProjectState([makeSession("sess_a")]);

    const result = applyAddBlankSession(state, {
      fileName: "空白生成位.png",
      filePath: "C:/project/images/generated/blank.png",
      sessionId: "sess_blank"
    });

    expect(result.state.selectedSessionId).toBe("sess_blank");
    expect(result.state.sessions.at(-1)).toMatchObject({
      fileName: "空白生成位.png",
      filePath: "C:/project/images/generated/blank.png",
      id: "sess_blank",
      status: "idle"
    });
  });

  test("appends generated records for generation tool writeback", () => {
    const state = makeProjectState([makeSession("sess_a")]);

    const result = applyAppendGeneratedRecord(state, { sessionId: "sess_a", generatedFilePath: "C:/generated/new.png" });

    expect(result.state.sessions[0]).toMatchObject({
      generatedFilePath: "C:/generated/new.png",
      generatedFilePaths: ["C:/generated/new.png"],
      showOriginalInList: false,
      status: "completed"
    });
  });
});

function makeProjectState(sessions: ImageSession[], selectedSessionId = sessions[0]?.id ?? null): ProjectState {
  return {
    project: { directory: "C:/project", name: "测试项目" },
    projectManagerState: makeProjectManagerState(),
    referenceImages: [],
    selectedSessionId,
    sessions
  };
}

function makeProjectManagerState(): ProjectManagerState {
  return {
    conversation: {
      id: "conversation-1",
      messages: []
    },
    plans: []
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
