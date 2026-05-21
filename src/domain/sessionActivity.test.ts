import { describe, expect, test } from "vitest";
import type { AppLogEntry } from "../../electron/ipcTypes";
import { getSessionActivityLogs } from "./sessionActivity";

describe("session activity", () => {
  test("keeps only current session chat and image progress logs", () => {
    const logs: AppLogEntry[] = [
      entry("chat:img-1", "会话已发送，模型正在分析..."),
      entry("image:img-1", "图片已准备：1024x1536，开始请求生成..."),
      entry("chat:img-2", "另一张图的会话"),
      entry(undefined, "全局日志"),
      entry("image:img-1", "模型已返回，正在下载结果图片...")
    ];

    expect(getSessionActivityLogs(logs, "img-1")).toEqual([
      entry("chat:img-1", "会话已发送，模型正在分析..."),
      entry("image:img-1", "图片已准备：1024x1536，开始请求生成..."),
      entry("image:img-1", "模型已返回，正在下载结果图片...")
    ]);
  });

  test("limits activity to the newest entries", () => {
    const logs = Array.from({ length: 10 }, (_, index) => entry("chat:img-1", `进度 ${index + 1}`));

    expect(getSessionActivityLogs(logs, "img-1", 3).map((log) => log.message)).toEqual(["进度 8", "进度 9", "进度 10"]);
  });
});

function entry(context: string | undefined, message: string): AppLogEntry {
  return {
    context,
    level: "info",
    message,
    timestamp: "2026-05-21T14:00:00.000Z"
  };
}
