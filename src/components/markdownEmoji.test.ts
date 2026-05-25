import { describe, expect, test } from "vitest";
import { renderEmojiShortcodes } from "./markdownEmoji";

describe("renderEmojiShortcodes", () => {
  test("renders supported emoji shortcodes", () => {
    expect(renderEmojiShortcodes("计划已更新 :sparkles: 可以执行 :white_check_mark:")).toBe("计划已更新 ✨ 可以执行 ✅");
  });

  test("keeps unknown shortcodes unchanged", () => {
    expect(renderEmojiShortcodes("这个短码还不支持 :unknown_emoji:")).toBe("这个短码还不支持 :unknown_emoji:");
  });

  test("does not rewrite shortcodes inside markdown code spans or fences", () => {
    const content = "正文 :sparkles: `代码 :sparkles:`\n```text\n块 :white_check_mark:\n```";

    expect(renderEmojiShortcodes(content)).toBe("正文 ✨ `代码 :sparkles:`\n```text\n块 :white_check_mark:\n```");
  });
});
