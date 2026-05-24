import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { computeMemorySimilarity, createEsseMemoryStore } from "./esseMemoryStore";

const tempRoots: string[] = [];

describe("esseMemoryStore", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("adds, lists, renders, and removes memories from markdown", async () => {
    const filePath = await makeMemoryPath();
    const store = createEsseMemoryStore(filePath);

    const added = await store.add({ category: "默认约束", content: "不要加任何文字或水印" });
    expect("ok" in added).toBe(false);
    expect(added).toMatchObject({ category: "默认约束", content: "不要加任何文字或水印" });

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toMatch(/^mem_[a-f0-9]{8}$/);
    await expect(readFile(filePath, "utf8")).resolves.toContain(`- [${list[0]?.id}] 不要加任何文字或水印`);

    const prompt = await store.renderForPrompt();
    expect(prompt).toContain("==== 全局记忆");
    expect(prompt).toContain("默认约束：");
    expect(prompt).toContain("- 不要加任何文字或水印");

    await expect(store.remove(list[0]?.id ?? "")).resolves.toEqual({ removed: list[0] });
    await expect(store.list()).resolves.toEqual([]);
    await expect(store.renderForPrompt()).resolves.toBe("");
  });

  test("returns empty list when the memory file is missing", async () => {
    const filePath = await makeMemoryPath();
    const store = createEsseMemoryStore(filePath);

    await expect(store.list()).resolves.toEqual([]);
    await store.add({ content: "主要做家居电商主图" });
    await unlink(filePath);

    await expect(store.list()).resolves.toEqual([]);
  });

  test("repairs manually added lines without ids", async () => {
    const filePath = await makeMemoryPath();
    await writeFile(filePath, "# Esse 记忆\n\n## 用户偏好\n- 主要做家居电商主图\n", "utf8");
    const store = createEsseMemoryStore(filePath);

    const entries = await store.list();
    expect(entries).toMatchObject([{ category: "用户偏好", content: "主要做家居电商主图" }]);
    expect(entries[0]?.id).toMatch(/^mem_[a-f0-9]{8}$/);
    await expect(readFile(filePath, "utf8")).resolves.toContain(`- [${entries[0]?.id}] 主要做家居电商主图`);
  });

  test("keeps memory management rules when prompt rendering truncates many entries", async () => {
    const filePath = await makeMemoryPath();
    const longEntries = Array.from({ length: 40 }, (_value, index) =>
      `- [mem_${index.toString(16).padStart(8, "0")}] 第 ${index} 条长期偏好，包含一段较长描述用于占满提示词预算，仍然不能挤掉记忆管理规则`
    );
    await writeFile(filePath, ["# Esse 记忆", "", "## 用户偏好", ...longEntries].join("\n"), "utf8");
    const store = createEsseMemoryStore(filePath);

    const prompt = await store.renderForPrompt();

    expect(prompt).toContain("记忆管理规则：");
    expect(prompt).toContain("用户说“记住 xxx”时调 remember_user_preference");
    expect(prompt).toContain("更多记忆请用 list_remembered_preferences 查看");
    expect(prompt.length).toBeLessThanOrEqual(2000);
  });

  test("detects near-duplicate memories without writing a second entry", async () => {
    const filePath = await makeMemoryPath();
    const store = createEsseMemoryStore(filePath);

    const first = await store.add({ content: "输出默认 2K，除非明确说其他尺寸" });
    expect("id" in first).toBe(true);
    const duplicate = await store.add({ content: "输出默认2K除非明确说其他尺寸" });

    expect("ok" in duplicate).toBe(true);
    expect(duplicate).toMatchObject({ ok: false, conflictsWith: { content: "输出默认 2K，除非明确说其他尺寸" } });
    if ("id" in first && "conflictsWith" in duplicate) {
      expect(duplicate.conflictsWith.id).toBe(first.id);
    }
    await expect(store.list()).resolves.toHaveLength(1);
  });

  test("serializes concurrent adds", async () => {
    const filePath = await makeMemoryPath();
    const store = createEsseMemoryStore(filePath);

    await Promise.all([
      store.add({ category: "用户偏好", content: "偏好浅色背景" }),
      store.add({ category: "工作流惯例", content: "新品先出四张候选" })
    ]);

    const entries = await store.list();
    expect(entries.map((entry) => entry.content).sort()).toEqual(["偏好浅色背景", "新品先出四张候选"].sort());
  });

  test("normalizes punctuation and whitespace for similarity", () => {
    expect(computeMemorySimilarity("输出默认 2K，除非明确说其他尺寸", "输出默认2K除非明确说其他尺寸")).toBe(1);
  });
});

async function makeMemoryPath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-memory-"));
  tempRoots.push(root);
  return path.join(root, "esse-memory.md");
}
