import { describe, expect, test } from "vitest";
import type { EsseMemoryEntry, ProjectSnapshot } from "../ipcTypes";
import {
  getProjectOverviewCapability,
  getSessionRecordsCapability,
  listReferenceImagesCapability,
  listRememberedPreferencesCapability,
  listSessionsCapability,
  readImageMetadataCapability,
  scanUnreferencedFilesCapability,
  type BatchImagerWorkbenchCapabilityRuntime
} from "./batchImagerWorkbenchCapabilityApi";
import type { EsseMemoryStore } from "./esseMemoryStore";

describe("batchImagerWorkbenchCapabilityApi", () => {
  test("reads project overview from BatchImager product state", () => {
    const result = getProjectOverviewCapability({
      state: createSnapshot({
        project: {
          createdAt: "2026-05-24T00:00:00.000Z",
          directory: "/private/project",
          id: "project_1",
          imageCount: 2,
          name: "春季主图",
          updatedAt: "2026-05-24T00:00:00.000Z"
        },
        selectedSessionId: "sess_2",
        sessions: [createSession("sess_1"), createSession("sess_2")]
      })
    });

    expect(result).toEqual({
      ok: true,
      text: "已读取项目概览。",
      details: {
        imageCount: 2,
        projectDirectory: "/private/project",
        projectId: "project_1",
        projectName: "春季主图",
        selectedSessionId: "sess_2"
      }
    });
  });

  test("lists sessions with product ids and safe workspace reference ids", () => {
    const result = listSessionsCapability({
      state: createSnapshot({
        selectedSessionId: "sess_2",
        sessions: [
          createSession("sess_1", {
            fileName: "原图-A.jpg",
            filePath: "/private/project/images/original/a.jpg",
            generatedFilePath: "/private/project/images/generated/a-2.png",
            generatedFilePaths: [
              "/private/project/images/generated/a-1.png",
              "/private/project/images/generated/a-2.png"
            ]
          }),
          createSession("sess_2", {
            fileName: "新生成-B.png",
            filePath: "/private/project/images/generated/b.png",
            originatedFromGeneration: true
          })
        ]
      })
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("img-1; id=sess_1; referenceImageId=workspace-ref-sess_1");
    expect(result.text).toContain("img-2; id=sess_2; referenceImageId=workspace-ref-sess_2");
    expect(result.text).toContain("selected=true");
    expect(result.details.sessions).toEqual([
      {
        currentImageSource: "generated",
        displayLabel: "img-1",
        fileName: "原图-A.jpg",
        generatedRecordCount: 2,
        id: "sess_1",
        isSelected: false,
        referenceImageId: "workspace-ref-sess_1"
      },
      {
        currentImageSource: "generated",
        displayLabel: "img-2",
        fileName: "新生成-B.png",
        generatedRecordCount: 0,
        id: "sess_2",
        isSelected: true,
        referenceImageId: "workspace-ref-sess_2"
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("/private/project");
  });

  test("lists generated records without exposing file paths", () => {
    const result = getSessionRecordsCapability(
      {
        state: createSnapshot({
          sessions: [
            createSession("sess_generated", {
              fileName: "主图.png",
              filePath: "/private/project/images/generated/seed.png",
              generatedFilePath: "/private/project/images/generated/record-2.png",
              generatedFilePaths: [
                "/private/project/images/generated/record-1.png",
                "/private/project/images/generated/record-2.png"
              ],
              originatedFromGeneration: true
            })
          ]
        })
      },
      { sessionId: "sess_generated" }
    );

    expect(result.ok).toBe(true);
    expect(result.text).toContain("recordIndex=1; fileName=record-1.png; isCurrent=false; isPrimary=true");
    expect(result.text).toContain("recordIndex=2; fileName=record-2.png; isCurrent=true");
    expect(result.details.records).toEqual([
      { fileName: "record-1.png", isCurrent: false, isPrimary: true, recordIndex: 1 },
      { fileName: "record-2.png", isCurrent: true, recordIndex: 2 }
    ]);
    expect(JSON.stringify(result)).not.toContain("/private/project");
  });

  test("returns a recoverable error for unknown sessions", () => {
    const result = getSessionRecordsCapability({ state: createSnapshot() }, { sessionId: "missing" });

    expect(result).toEqual({
      ok: false,
      reason: "session not found",
      detail: "no session with id missing",
      suggestedNext: "call list_sessions to list current ids."
    });
  });

  test("delegates image metadata through the workbench runtime and formats model-visible text", async () => {
    const result = await readImageMetadataCapability(
      {
        readImageMetadata: async (request) => ({
          byteSize: 2048,
          fileName: "record-1.png",
          format: "png",
          height: 768,
          recordIndex: request.recordIndex,
          sessionId: request.sessionId,
          sourceType: "generated-record",
          width: 1024
        }),
        state: createSnapshot()
      },
      { recordIndex: 1, sessionId: "sess_1" }
    );

    expect(result.ok).toBe(true);
    expect(result.text).toBe(
      "已读取图片信息：sessionId=sess_1; sourceType=generated-record; recordIndex=1; fileName=record-1.png; width=1024; height=768; format=png; byteSize=2048"
    );
    expect(result.details.metadata).toMatchObject({ fileName: "record-1.png", width: 1024 });
  });

  test("combines project, conversation, and current-turn reference images", () => {
    const result = listReferenceImagesCapability({
      getTurnReferenceImagePaths: () => ["/private/uploads/turn-style.png"],
      state: createSnapshot({
        projectManagerState: {
          conversation: {
            messages: [
              {
                content: "参考这张",
                id: "msg_1",
                referenceFilePaths: ["/private/uploads/history-style.png"],
                role: "user"
              }
            ]
          }
        },
        referenceImages: [
          {
            filePath: "/private/project/references/brand.png",
            id: "ref_brand",
            label: "品牌参考"
          }
        ]
      })
    });

    expect(result.ok).toBe(true);
    expect(result.details.referenceImages).toEqual([
      { fileName: "brand.png", id: "ref_brand", label: "品牌参考" },
      { fileName: "history-style.png", id: "conversation-ref-1", label: "对话参考图 1" },
      { fileName: "turn-style.png", id: "turn-ref-1", label: "本轮参考图 1" }
    ]);
    expect(result.text).toContain("id=ref_brand label=品牌参考 fileName=brand.png");
    expect(result.text).toContain("id=conversation-ref-1 label=对话参考图 1 fileName=history-style.png");
    expect(result.text).toContain("id=turn-ref-1 label=本轮参考图 1 fileName=turn-style.png");
    expect(JSON.stringify(result)).not.toContain("/private/");
  });

  test("lists remembered preferences through the configured memory store", async () => {
    const memory: EsseMemoryEntry = {
      category: "用户偏好",
      content: "默认保留产品阴影",
      createdAt: "2026-05-24T00:00:00.000Z",
      id: "mem_12345678"
    };
    const result = await listRememberedPreferencesCapability({
      memoryStore: createMemoryStore([memory]),
      state: createSnapshot()
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe("1. [mem_12345678] 用户偏好：默认保留产品阴影");
    expect(result.details.memories).toEqual([memory]);
  });

  test("scans unreferenced files through candidate ids only", async () => {
    const result = await scanUnreferencedFilesCapability({
      scanUnreferencedFiles: async () => [
        {
          byteSize: 4096,
          candidateId: "unref_1",
          fileName: "orphan.png",
          filePath: "/private/project/images/generated/orphan.png"
        }
      ],
      state: createSnapshot()
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("candidateId=unref_1; fileName=orphan.png; byteSize=4096");
    expect(result.details.candidates).toEqual([
      {
        byteSize: 4096,
        candidateId: "unref_1",
        fileName: "orphan.png"
      }
    ]);
    expect(JSON.stringify(result.details)).not.toContain("/private/project");
    expect(result.text).not.toContain("/private/project");
  });
});

function createMemoryStore(entries: EsseMemoryEntry[]): EsseMemoryStore {
  return {
    add: async () => entries[0] ?? {
      category: "用户偏好",
      content: "empty",
      createdAt: "",
      id: "mem_empty"
    },
    getFilePath: () => "/private/memory.md",
    list: async () => entries,
    remove: async () => ({ removed: null }),
    renderForPrompt: async () => ""
  };
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
    sessions: [createSession("sess_1")],
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
