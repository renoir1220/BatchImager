import { describe, expect, it } from "vitest";
import {
  addSessionUserMessage,
  appendImageSessions,
  applySessionImageChoice,
  applySessionChatError,
  applySessionChatSuccess,
  applyGeneratedImageResult,
  applySessionGenerationError,
  createImageSessions,
  getSessionDisplayPath,
  getSessionGenerationSourcePath,
  getInitialSelectedSessionId,
  markSessionEsseTask,
  markSessionGenerating,
  markSessionProjectCommand,
  moveImageSession,
  removeImageSession,
  removeAllImageSessions,
  toggleSessionListImageSource
} from "./imageSessions";

describe("image sessions", () => {
  it("creates stable image sessions from file paths", () => {
    const sessions = createImageSessions([
      "C:/shots/IMG_0001.JPG",
      "C:/shots/nested/IMG_0002.png"
    ]);

    expect(sessions).toEqual([
      {
        id: "img-1",
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        chatMessages: [],
        chatStatus: "idle",
        status: "idle"
      },
      {
        id: "img-2",
        filePath: "C:/shots/nested/IMG_0002.png",
        fileName: "IMG_0002.png",
        chatMessages: [],
        chatStatus: "idle",
        status: "idle"
      }
    ]);
  });

  it("selects the first session when there is no current selection", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG"]);

    expect(getInitialSelectedSessionId(sessions, null)).toBe("img-1");
  });

  it("preserves an existing selected session when it still exists", () => {
    const sessions = createImageSessions([
      "C:/shots/IMG_0001.JPG",
      "C:/shots/IMG_0002.JPG"
    ]);

    expect(getInitialSelectedSessionId(sessions, "img-2")).toBe("img-2");
  });

  it("appends only new image paths and keeps existing session state", () => {
    const existing = createImageSessions(["C:/shots/IMG_0001.JPG"]);
    existing[0].status = "completed";

    const sessions = appendImageSessions(existing, [
      "c:/shots/img_0001.jpg",
      "C:/shots/IMG_0002.JPG"
    ]);

    expect(sessions).toEqual([
      {
        id: "img-1",
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        chatMessages: [],
        chatStatus: "idle",
        status: "completed"
      },
      {
        id: "img-2",
        filePath: "C:/shots/IMG_0002.JPG",
        fileName: "IMG_0002.JPG",
        chatMessages: [],
        chatStatus: "idle",
        status: "idle"
      }
    ]);
  });

  it("marks a session as generating without mutating other sessions", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG", "C:/shots/IMG_0002.JPG"]);

    expect(markSessionGenerating(sessions, "img-2", "室内商品图")).toEqual([
      {
        id: "img-1",
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        chatMessages: [],
        chatStatus: "idle",
        status: "idle"
      },
      {
        chatMessages: [],
        chatStatus: "idle",
        errorMessage: undefined,
        filePath: "C:/shots/IMG_0002.JPG",
        fileName: "IMG_0002.JPG",
        id: "img-2",
        lastPrompt: "室内商品图",
        status: "generating"
      }
    ]);
  });

  it("adds the batch prompt to each matching session context when generation starts", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG"]);

    expect(markSessionGenerating(sessions, "img-1", "生成白底电商主图", "batch-1", ["C:/refs/room.png"], "C:/shots/IMG_0001.JPG")).toEqual([
      {
        chatMessages: [
          {
            id: "batch-1",
            role: "context",
            content: "批量处理：生成白底电商主图\n参考图：1 张",
            contextType: "batch-prompt",
            sourceFilePath: "C:/shots/IMG_0001.JPG",
            referenceFilePaths: ["C:/refs/room.png"]
          }
        ],
        chatStatus: "idle",
        errorMessage: undefined,
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        id: "img-1",
        lastPrompt: "生成白底电商主图",
        status: "generating"
      }
    ]);
  });

  it("adds a project manager command context before worker generation starts", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG"]);

    expect(
      markSessionProjectCommand(
        sessions,
        "img-1",
        {
          instruction: "生成客厅茶几场景鲜花商品图",
          referenceFilePaths: ["C:/refs/living-room.png"],
          sourceFilePath: "C:/shots/IMG_0001.JPG"
        },
        "project-command-1"
      )
    ).toEqual([
      {
        chatMessages: [
          {
            id: "project-command-1",
            role: "context",
            content: "来自 Esse方案：生成客厅茶几场景鲜花商品图\n参考图：1 张",
            contextType: "project-command",
            sourceFilePath: "C:/shots/IMG_0001.JPG",
            referenceFilePaths: ["C:/refs/living-room.png"]
          }
        ],
        chatStatus: "idle",
        errorMessage: undefined,
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        id: "img-1",
        lastPrompt: "生成客厅茶几场景鲜花商品图",
        status: "generating"
      }
    ]);
  });

  it("freezes the batch input image snapshot even after a new result is generated", () => {
    const sessions = applyGeneratedImageResult(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "C:/generated/first.png");
    const generating = markSessionGenerating(
      sessions,
      "img-1",
      "用当前图生成教室商品图",
      "batch-1",
      ["C:/refs/classroom.png"],
      getSessionGenerationSourcePath(sessions[0])
    );
    const completed = applyGeneratedImageResult(generating, "img-1", "C:/generated/second.png", "result-1");

    expect(completed[0].chatMessages[0]).toMatchObject({
      contextType: "generated-image",
      generatedFilePath: "C:/generated/first.png"
    });
    expect(completed[0].chatMessages[1]).toMatchObject({
      contextType: "batch-prompt",
      sourceFilePath: "C:/generated/first.png",
      referenceFilePaths: ["C:/refs/classroom.png"]
    });
    expect(completed[0].chatMessages[2]).toMatchObject({
      contextType: "generated-image",
      generatedFilePath: "C:/generated/second.png"
    });
    expect(getSessionGenerationSourcePath(completed[0])).toBe("C:/generated/second.png");
  });

  it("keeps Esse prompt reference images when dispatching a task", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG"]);
    const result = markSessionEsseTask(
      sessions,
      "img-1",
      {
        instruction: "根据参考图生成内部构造图",
        referenceFilePaths: ["C:/refs/pasted.png"],
        sourceFilePath: "C:/shots/IMG_0001.JPG"
      },
      "esse-task-1"
    );

    expect(result[0].chatMessages[0]).toMatchObject({
      content: "来自 Esse智能体：根据参考图生成内部构造图\n参考图：1 张",
      contextType: "esse-task",
      referenceFilePaths: ["C:/refs/pasted.png"],
      sourceFilePath: "C:/shots/IMG_0001.JPG"
    });
  });

  it("applies generated output path to the matching session", () => {
    const sessions = markSessionGenerating(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "室内商品图");

    expect(applyGeneratedImageResult(sessions, "img-1", "C:/generated/out.png", "result-1")).toEqual([
      {
        errorMessage: undefined,
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        generatedFilePath: "C:/generated/out.png",
        generatedFilePaths: ["C:/generated/out.png"],
        chatMessages: [
          { id: "result-1", role: "context", content: "生成完成，已加入会话上下文。", contextType: "generated-image", generatedFilePath: "C:/generated/out.png" }
        ],
        chatStatus: "idle",
        id: "img-1",
        lastPrompt: "室内商品图",
        showOriginalInList: false,
        status: "completed"
      }
    ]);
  });

  it("keeps every generated output in history while using the newest image", () => {
    const sessions = applyGeneratedImageResult(
      applyGeneratedImageResult(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "C:/generated/first.png"),
      "img-1",
      "C:/generated/second.png"
    );

    expect(sessions[0].generatedFilePaths).toEqual(["C:/generated/first.png", "C:/generated/second.png"]);
    expect(getSessionGenerationSourcePath(sessions[0])).toBe("C:/generated/second.png");
  });

  it("uses a chosen historical image as the next generation source", () => {
    const sessions = applyGeneratedImageResult(
      applyGeneratedImageResult(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "C:/generated/first.png"),
      "img-1",
      "C:/generated/second.png"
    );

    const chosen = applySessionImageChoice(sessions, "img-1", "C:/generated/first.png");

    expect(chosen[0].generatedFilePath).toBe("C:/generated/first.png");
    expect(chosen[0].generatedFilePaths).toEqual(["C:/generated/first.png", "C:/generated/second.png"]);
    expect(getSessionGenerationSourcePath(chosen[0])).toBe("C:/generated/first.png");
  });

  it("can return to the original image as the next generation source", () => {
    const sessions = applyGeneratedImageResult(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "C:/generated/out.png");

    const chosen = applySessionImageChoice(sessions, "img-1", "C:/shots/IMG_0001.JPG");

    expect(chosen[0].generatedFilePath).toBeUndefined();
    expect(chosen[0].generatedFilePaths).toEqual(["C:/generated/out.png"]);
    expect(getSessionGenerationSourcePath(chosen[0])).toBe("C:/shots/IMG_0001.JPG");
  });

  it("toggles the workspace cell between original and current image without changing the generation source", () => {
    const sessions = applyGeneratedImageResult(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "C:/generated/out.png");

    const showingOriginal = toggleSessionListImageSource(sessions, "img-1");
    const showingCurrentAgain = toggleSessionListImageSource(showingOriginal, "img-1");

    expect(getSessionDisplayPath(showingOriginal[0])).toBe("C:/shots/IMG_0001.JPG");
    expect(getSessionGenerationSourcePath(showingOriginal[0])).toBe("C:/generated/out.png");
    expect(getSessionDisplayPath(showingCurrentAgain[0])).toBe("C:/generated/out.png");
  });

  it("moves one image session before another without changing session state", () => {
    const sessions = applyGeneratedImageResult(
      createImageSessions(["C:/shots/IMG_0001.JPG", "C:/shots/IMG_0002.JPG", "C:/shots/IMG_0003.JPG"]),
      "img-3",
      "C:/generated/out.png"
    );

    const moved = moveImageSession(sessions, "img-3", "img-1");

    expect(moved.map((session) => session.id)).toEqual(["img-3", "img-1", "img-2"]);
    expect(moved[0]).toMatchObject({
      filePath: "C:/shots/IMG_0003.JPG",
      generatedFilePath: "C:/generated/out.png",
      generatedFilePaths: ["C:/generated/out.png"],
      status: "completed"
    });
  });

  it("moves a dragged image session to a later target position", () => {
    const sessions = createImageSessions([
      "C:/shots/IMG_0001.JPG",
      "C:/shots/IMG_0002.JPG",
      "C:/shots/IMG_0003.JPG"
    ]);

    const moved = moveImageSession(sessions, "img-1", "img-3");

    expect(moved.map((session) => session.id)).toEqual(["img-2", "img-3", "img-1"]);
  });

  it("returns the same order when image session move ids are not usable", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG", "C:/shots/IMG_0002.JPG"]);

    expect(moveImageSession(sessions, "img-1", "img-1")).toBe(sessions);
    expect(moveImageSession(sessions, "img-404", "img-1")).toBe(sessions);
    expect(moveImageSession(sessions, "img-1", "img-404")).toBe(sessions);
  });

  it("removes the selected image and selects the next image", () => {
    const sessions = createImageSessions([
      "C:/shots/IMG_0001.JPG",
      "C:/shots/IMG_0002.JPG",
      "C:/shots/IMG_0003.JPG"
    ]);

    expect(removeImageSession(sessions, "img-2")).toEqual({
      selectedSessionId: "img-3",
      sessions: [
        {
          id: "img-1",
          filePath: "C:/shots/IMG_0001.JPG",
          fileName: "IMG_0001.JPG",
          chatMessages: [],
          chatStatus: "idle",
          status: "idle"
        },
        {
          id: "img-3",
          filePath: "C:/shots/IMG_0003.JPG",
          fileName: "IMG_0003.JPG",
          chatMessages: [],
          chatStatus: "idle",
          status: "idle"
        }
      ]
    });
  });

  it("selects the previous image when removing the last image", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG", "C:/shots/IMG_0002.JPG"]);

    expect(removeImageSession(sessions, "img-2").selectedSessionId).toBe("img-1");
  });

  it("clears all images and selected state", () => {
    expect(removeAllImageSessions()).toEqual({ selectedSessionId: null, sessions: [] });
  });

  it("keeps the original image visible when generation fails", () => {
    const sessions = markSessionGenerating(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "室内商品图");

    expect(applySessionGenerationError(sessions, "img-1", "网络错误")).toEqual([
      {
        errorMessage: "网络错误",
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        chatMessages: [],
        chatStatus: "idle",
        id: "img-1",
        lastPrompt: "室内商品图",
        status: "failed"
      }
    ]);
  });

  it("adds a user chat message and marks the session as sending", () => {
    const sessions = createImageSessions(["C:/shots/IMG_0001.JPG"]);

    expect(addSessionUserMessage(sessions, "img-1", "帮我生成白底图", "m-1")).toEqual([
      {
        chatMessages: [{ id: "m-1", role: "user", content: "帮我生成白底图" }],
        chatStatus: "sending",
        errorMessage: undefined,
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        id: "img-1",
        status: "idle"
      }
    ]);
  });

  it("adds assistant chat output and applies generated image paths", () => {
    const sessions = addSessionUserMessage(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "生成白底图", "m-1");

    expect(
      applySessionChatSuccess(
        sessions,
        "img-1",
        {
          content: "已生成白底图。",
          generatedFilePath: "C:/generated/out.png"
        },
        "m-2"
      )
    ).toEqual([
      {
        chatMessages: [
          { id: "m-1", role: "user", content: "生成白底图" },
          { id: "m-2", role: "assistant", content: "已生成白底图。", generatedFilePath: "C:/generated/out.png" }
        ],
        chatStatus: "idle",
        errorMessage: undefined,
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        generatedFilePath: "C:/generated/out.png",
        generatedFilePaths: ["C:/generated/out.png"],
        id: "img-1",
        showOriginalInList: false,
        status: "completed"
      }
    ]);
  });

  it("adds chat errors without dropping existing messages", () => {
    const sessions = addSessionUserMessage(createImageSessions(["C:/shots/IMG_0001.JPG"]), "img-1", "生成白底图", "m-1");

    expect(applySessionChatError(sessions, "img-1", "模型调用失败", "m-2")).toEqual([
      {
        chatMessages: [
          { id: "m-1", role: "user", content: "生成白底图" },
          { id: "m-2", role: "error", content: "模型调用失败" }
        ],
        chatStatus: "idle",
        errorMessage: "模型调用失败",
        filePath: "C:/shots/IMG_0001.JPG",
        fileName: "IMG_0001.JPG",
        id: "img-1",
        status: "failed"
      }
    ]);
  });
});
