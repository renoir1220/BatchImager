import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import {
  appendWorkbenchUndoEntry,
  createWorkbenchUndoEntry,
  deleteWorkbenchSession,
  deleteWorkbenchSessionRecord,
  duplicateWorkbenchSession,
  mergeWorkbenchSessions,
  renameWorkbenchSession,
  reorderWorkbenchSessions,
  restoreOriginalWorkbenchImage,
  restoreWorkbenchSessionRecord,
  setWorkbenchSessionPrompt,
  splitWorkbenchSession,
  undoLastWorkbenchActions
} from "./batchImagerWorkbenchActions";

describe("batchImagerWorkbenchActions", () => {
  test("updates safe session state without depending on an Esse runtime", () => {
    let state = createSnapshot({
      selectedSessionId: "sess_2",
      sessions: [
        createSession("sess_1", { fileName: "old-a.jpg" }),
        createSession("sess_2", {
          generatedFilePath: "/project/generated/b-1.png",
          generatedFilePaths: ["/project/generated/b-1.png"]
        })
      ]
    });

    state = expectOk(renameWorkbenchSession(state, { fileName: "hero-a.jpg", sessionId: "sess_1" })).state;
    state = expectOk(setWorkbenchSessionPrompt(state, { prompt: "白底主图，保留主体", sessionId: "sess_1" })).state;
    state = expectOk(restoreOriginalWorkbenchImage(state, { sessionId: "sess_2" })).state;
    state = expectOk(reorderWorkbenchSessions(state, { sessionIds: ["sess_2", "sess_1"] })).state;

    expect(state.sessions.map((session) => session.id)).toEqual(["sess_2", "sess_1"]);
    expect(state.sessions[1]?.fileName).toBe("hero-a.jpg");
    expect(state.sessions[1]?.lastPrompt).toBe("白底主图，保留主体");
    expect(state.sessions[0]?.generatedFilePath).toBeUndefined();
    expect(state.sessions[0]?.generatedFilePaths).toEqual(["/project/generated/b-1.png"]);
  });

  test("handles generated records and removes generation-originated sessions when their only record is deleted", () => {
    let state = createSnapshot();

    state = expectOk(restoreWorkbenchSessionRecord(state, { recordIndex: 1, sessionId: "sess_1" })).state;
    expect(state.sessions[0]?.generatedFilePath).toBe("/project/generated/a-1.png");

    state = expectOk(deleteWorkbenchSessionRecord(state, { recordIndex: 2, sessionId: "sess_1" })).state;
    expect(state.sessions[0]?.generatedFilePaths).toEqual(["/project/generated/a-1.png"]);

    const deleted = deleteWorkbenchSessionRecord(
      createSnapshot({
        selectedSessionId: "sess_generated",
        sessions: [
          createSession("sess_generated", {
            filePath: "/project/generated/primary.png",
            generatedFilePath: "/project/generated/primary.png",
            generatedFilePaths: ["/project/generated/primary.png"],
            originatedFromGeneration: true
          })
        ]
      }),
      { recordIndex: 1, sessionId: "sess_generated" }
    );

    expectOk(deleted);
    expect(deleted.state.sessions).toEqual([]);
    expect(deleted.state.project.imageCount).toBe(0);
    expect(deleted.state.selectedSessionId).toBeNull();
  });

  test("splits, duplicates, merges, and deletes workbench sessions as product state actions", () => {
    let state = createSnapshot({
      sessions: [
        createSession("sess_1", {
          generatedFilePath: "/project/generated/a-2.png",
          generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png", "/project/generated/a-3.png"]
        }),
        createSession("sess_2", {
          generatedFilePath: "/project/generated/b-1.png",
          generatedFilePaths: ["/project/generated/b-1.png"]
        })
      ]
    });

    const split = expectOk(splitWorkbenchSession(state, {
      fileName: "拆分记录.jpg",
      recordIndexes: [2, 3],
      sessionId: "sess_1"
    }));
    state = split.state;
    const splitSessionId = split.result.affectedSessionIds[1]!;
    expect(state.sessions).toHaveLength(3);
    expect(state.sessions.find((session) => session.id === splitSessionId)).toMatchObject({
      fileName: "拆分记录.jpg",
      generatedFilePaths: ["/project/generated/a-2.png", "/project/generated/a-3.png"],
      originatedFromGeneration: true
    });

    const duplicate = expectOk(duplicateWorkbenchSession(state, { fileName: "副本.jpg", sessionId: "sess_2" }));
    state = duplicate.state;
    const duplicateSessionId = duplicate.result.affectedSessionIds[1]!;
    expect(state.sessions.find((session) => session.id === duplicateSessionId)).toMatchObject({
      chatMessages: [],
      fileName: "副本.jpg",
      generatedFilePaths: ["/project/generated/b-1.png"]
    });

    state = expectOk(mergeWorkbenchSessions(state, {
      sourceSessionIds: [duplicateSessionId],
      targetSessionId: "sess_2"
    })).state;
    expect(state.sessions.some((session) => session.id === duplicateSessionId)).toBe(false);
    expect(state.project.imageCount).toBe(3);

    state = expectOk(deleteWorkbenchSession(state, { sessionId: splitSessionId })).state;
    expect(state.sessions.some((session) => session.id === splitSessionId)).toBe(false);
    expect(state.project.imageCount).toBe(2);
  });

  test("stores undo entries and restores previous workbench state with revision warnings", () => {
    const initialState = createSnapshot({
      sessions: [createSession("sess_1"), createSession("sess_2")]
    });
    const renamed = expectOk(renameWorkbenchSession(initialState, { fileName: "renamed.jpg", sessionId: "sess_1" }));
    const withUndo = appendWorkbenchUndoEntry(
      renamed.state,
      createWorkbenchUndoEntry({
        affectedSessionIds: renamed.result.affectedSessionIds,
        beforeState: initialState,
        sinkRevisionAfter: 1,
        summary: renamed.result.summary,
        toolName: "rename_session"
      })
    );

    const undone = expectOk(undoLastWorkbenchActions(withUndo, 1, 2));

    expect(stripUndoLog(undone.state)).toEqual(stripUndoLog(initialState));
    expect(undone.state.esseUndoLog?.[0]?.undone).toBe(true);
    expect(undone.result.summary).toContain("⚠️");
    expect(undone.result.summary).toContain("1 个中间工作区写入");
  });

  test("rejects invalid parameters without changing the original state", () => {
    const state = createSnapshot({
      sessions: [
        createSession("sess_1", {
          generatedFilePaths: ["/project/generated/a-1.png", "/project/generated/a-2.png"]
        }),
        createSession("sess_2")
      ]
    });

    const reorder = reorderWorkbenchSessions(state, { sessionIds: ["sess_2"] });
    const split = splitWorkbenchSession(state, { recordIndexes: [1, 2], sessionId: "sess_1" });

    expect(reorder.result).toMatchObject({ ok: false, reason: "sessionIds must be a full permutation" });
    expect(reorder.state).toBe(state);
    expect(split.result).toMatchObject({ ok: false, reason: "cannot split all records" });
    expect(split.state).toBe(state);
  });
});

function expectOk<T extends { result: { ok: boolean } }>(mutation: T): Extract<T, { result: { ok: true } }> {
  expect(mutation.result.ok).toBe(true);
  return mutation as Extract<T, { result: { ok: true } }>;
}

function stripUndoLog(snapshot: ProjectSnapshot): ProjectSnapshot {
  const { esseUndoLog: _esseUndoLog, ...rest } = snapshot;
  return rest;
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
