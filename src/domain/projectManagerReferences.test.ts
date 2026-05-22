import { describe, expect, test } from "vitest";
import type { ProjectManagerState } from "../types/projectManager";
import { resolveProjectManagerReferenceImages } from "./projectManagerReferences";

describe("projectManagerReferences", () => {
  test("reuses the latest prior reference images when the next Esse prompt points back to them", () => {
    const state = makeState([
      {
        content: "用这张参考图生成三个内部设计图",
        id: "user-1",
        referenceFilePaths: ["C:/project/references/cafe.jpg"],
        role: "user"
      },
      {
        content: "我先按这张参考图生成方案。",
        id: "assistant-1",
        role: "assistant"
      }
    ]);

    expect(resolveProjectManagerReferenceImages(state, "不是三种风格，是沿用第一个 prompt 里的参考图", [])).toEqual({
      referenceImagePaths: ["C:/project/references/cafe.jpg"]
    });
  });

  test("does not attach old references when the user starts an unrelated Esse request", () => {
    const state = makeState([
      {
        content: "用这张参考图生成三个内部设计图",
        id: "user-1",
        referenceFilePaths: ["C:/project/references/cafe.jpg"],
        role: "user"
      }
    ]);

    expect(resolveProjectManagerReferenceImages(state, "把新生成的图打包到桌面", [])).toEqual({
      referenceImagePaths: []
    });
  });

  test("asks the user for the missing attachment instead of continuing blindly", () => {
    const state = makeState([]);

    expect(resolveProjectManagerReferenceImages(state, "按附件里的参考图继续生成三张", [])).toEqual({
      errorMessage: "我没有收到可用的参考图附件，请先粘贴或添加参考图后再发送。",
      referenceImagePaths: []
    });
  });

  test("prefers newly pasted references over older conversation references", () => {
    const state = makeState([
      {
        content: "参考这张旧图",
        id: "user-1",
        referenceFilePaths: ["C:/project/references/old.jpg"],
        role: "user"
      }
    ]);

    expect(resolveProjectManagerReferenceImages(state, "按这个附件继续", ["C:/project/references/new.jpg"])).toEqual({
      referenceImagePaths: ["C:/project/references/new.jpg"]
    });
  });
});

function makeState(messages: ProjectManagerState["conversation"]["messages"]): ProjectManagerState {
  return {
    conversation: {
      id: "project-manager",
      messages
    },
    plans: []
  };
}
