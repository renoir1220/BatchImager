import { describe, expect, test } from "vitest";
import type { ProjectManagerState } from "../types/projectManager";
import { resolveProjectManagerReferenceImages } from "./projectManagerReferences";

describe("projectManagerReferences", () => {
  test("does not auto-reuse older conversation references based on wording", () => {
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
      referenceImagePaths: []
    });
  });

  test("does not attach old references when the user starts an unrelated agent request", () => {
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

  test("lets the agent provider decide how to handle reference wording when no attachment is available", () => {
    const state = makeState([]);

    expect(resolveProjectManagerReferenceImages(state, "按附件里的参考图继续生成三张", [])).toEqual({
      referenceImagePaths: []
    });
  });

  test("uses only newly pasted references and deduplicates them", () => {
    const state = makeState([
      {
        content: "参考这张旧图",
        id: "user-1",
        referenceFilePaths: ["C:/project/references/old.jpg"],
        role: "user"
      }
    ]);

    expect(resolveProjectManagerReferenceImages(state, "按这个附件继续", [
      "C:/project/references/new.jpg",
      " ",
      "C:/project/references/new.jpg"
    ])).toEqual({
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
