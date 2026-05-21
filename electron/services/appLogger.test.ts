import { describe, expect, test } from "vitest";
import { createAppLogger, type AppLogEntry } from "./appLogger";

describe("appLogger", () => {
  test("stores public log entries and broadcasts them to subscribers", () => {
    const emitted: AppLogEntry[] = [];
    const writtenLines: string[] = [];
    const logger = createAppLogger({
      maxEntries: 3,
      now: () => new Date("2026-05-21T14:00:00.000Z"),
      writeLine: async (line) => {
        writtenLines.push(line);
      }
    });

    const unsubscribe = logger.subscribe((entry) => emitted.push(entry));
    logger.info("开始生成", { detail: "batch started", publicMessage: "开始批量生成 3 张图片" });
    unsubscribe();
    logger.info("隐藏细节", { detail: "only backend" });

    expect(logger.getEntries()).toEqual([
      {
        context: undefined,
        level: "info",
        message: "开始批量生成 3 张图片",
        timestamp: "2026-05-21T14:00:00.000Z"
      }
    ]);
    expect(emitted).toEqual(logger.getEntries());
    expect(writtenLines[0]).toContain("\"message\":\"开始生成\"");
    expect(writtenLines[0]).toContain("\"detail\":\"batch started\"");
  });

  test("keeps only the newest public entries", () => {
    const logger = createAppLogger({
      maxEntries: 2,
      now: () => new Date("2026-05-21T14:00:00.000Z"),
      writeLine: async () => undefined
    });

    logger.info("one", { publicMessage: "第一条" });
    logger.info("two", { publicMessage: "第二条" });
    logger.info("three", { publicMessage: "第三条" });

    expect(logger.getEntries().map((entry) => entry.message)).toEqual(["第二条", "第三条"]);
  });
});
