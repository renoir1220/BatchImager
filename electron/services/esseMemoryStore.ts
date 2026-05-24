import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export type EsseMemoryCategory = "用户偏好" | "默认约束" | "工作流惯例";

export interface EsseMemoryEntry {
  category: EsseMemoryCategory;
  content: string;
  createdAt: string;
  id: string;
}

export interface EsseMemoryConflict {
  conflictsWith: EsseMemoryEntry;
  ok: false;
  similarity: number;
  suggestedNext: string;
}

export interface EsseMemoryStore {
  add(entry: { category?: EsseMemoryCategory; content: string }): Promise<EsseMemoryEntry | EsseMemoryConflict>;
  getFilePath(): string;
  list(): Promise<EsseMemoryEntry[]>;
  remove(id: string): Promise<{ removed: EsseMemoryEntry | null }>;
  renderForPrompt(): Promise<string>;
}

const MEMORY_CATEGORIES: EsseMemoryCategory[] = ["用户偏好", "默认约束", "工作流惯例"];
const MAX_MEMORY_COUNT = 100;
const MAX_MEMORY_CONTENT_LENGTH = 200;
const MEMORY_SIMILARITY_THRESHOLD = 0.85;
const MAX_PROMPT_CHARS = 2000;

export function createEsseMemoryStore(filePath: string): EsseMemoryStore {
  let queue: Promise<void> = Promise.resolve();

  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return {
    add: (entry) =>
      withLock(async () => {
        const content = entry.content.trim();
        if (!content) {
          throw new Error("memory content is required");
        }
        if (content.length > MAX_MEMORY_CONTENT_LENGTH) {
          throw new Error(`memory content must be ${MAX_MEMORY_CONTENT_LENGTH} characters or less`);
        }

        const entries = await readEntries(filePath, { repairMissingIds: true });
        if (entries.length >= MAX_MEMORY_COUNT) {
          throw new Error("memory full, forget some first");
        }

        const conflict = findMemoryConflict(entries, content);
        if (conflict) {
          return conflict;
        }

        const nextEntry: EsseMemoryEntry = {
          category: isMemoryCategory(entry.category) ? entry.category : "用户偏好",
          content,
          createdAt: new Date().toISOString(),
          id: createMemoryId(entries)
        };
        await writeEntries(filePath, [...entries, nextEntry]);
        return nextEntry;
      }),
    getFilePath: () => filePath,
    list: () => withLock(async () => await readEntries(filePath, { repairMissingIds: true })),
    remove: (id) =>
      withLock(async () => {
        const entries = await readEntries(filePath, { repairMissingIds: true });
        const removed = entries.find((entry) => entry.id === id) ?? null;
        if (!removed) {
          return { removed };
        }
        await writeEntries(filePath, entries.filter((entry) => entry.id !== id));
        return { removed };
      }),
    renderForPrompt: () =>
      withLock(async () => {
        const entries = await readEntries(filePath, { repairMissingIds: true });
        return renderMemoryForPrompt(entries);
      })
  };
}

export function computeMemorySimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (left === right) {
    return 1;
  }

  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 0;
  }

  return 1 - levenshtein(left, right) / maxLength;
}

async function readEntries(filePath: string, options: { repairMissingIds: boolean }): Promise<EsseMemoryEntry[]> {
  let markdown = "";
  try {
    markdown = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const parsed = parseMemoryMarkdown(markdown);
  if (options.repairMissingIds && parsed.needsRepair) {
    await writeEntries(filePath, parsed.entries);
  }
  return parsed.entries;
}

function parseMemoryMarkdown(markdown: string): { entries: EsseMemoryEntry[]; needsRepair: boolean } {
  const entries: EsseMemoryEntry[] = [];
  let currentCategory: EsseMemoryCategory | undefined;
  let needsRepair = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentCategory = isMemoryCategory(heading[1]) ? heading[1] : undefined;
      continue;
    }

    if (!currentCategory || !rawLine.trim().startsWith("- ")) {
      continue;
    }

    const withId = rawLine.match(/^-\s+\[(mem_[a-f0-9]{8})\]\s+(.+?)\s*$/i);
    if (withId) {
      entries.push({
        category: currentCategory,
        content: withId[2].trim(),
        createdAt: "",
        id: withId[1]
      });
      continue;
    }

    if (/^-\s+\[.+?\]/.test(rawLine)) {
      continue;
    }

    const withoutId = rawLine.match(/^-\s+(.+?)\s*$/);
    if (withoutId) {
      needsRepair = true;
      entries.push({
        category: currentCategory,
        content: withoutId[1].trim(),
        createdAt: "",
        id: createMemoryId(entries)
      });
    }
  }

  return { entries, needsRepair };
}

async function writeEntries(filePath: string, entries: EsseMemoryEntry[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, renderMemoryMarkdown(entries), "utf8");
  await rename(tempPath, filePath);
}

function renderMemoryMarkdown(entries: EsseMemoryEntry[]): string {
  const lines = ["# Esse 记忆", ""];
  for (const category of MEMORY_CATEGORIES) {
    lines.push(`## ${category}`);
    const categoryEntries = entries.filter((entry) => entry.category === category);
    if (categoryEntries.length) {
      lines.push(...categoryEntries.map((entry) => `- [${entry.id}] ${entry.content}`));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderMemoryForPrompt(entries: EsseMemoryEntry[]): string {
  if (!entries.length) {
    return "";
  }

  const lines = [
    "==== 全局记忆（用户跨项目偏好，必须遵守）====",
    ...MEMORY_CATEGORIES.flatMap((category) => {
      const categoryEntries = entries.filter((entry) => entry.category === category);
      return categoryEntries.length ? [`${category}：`, ...categoryEntries.map((entry) => `- ${entry.content}`)] : [];
    }),
    "记忆管理规则：",
    "- 在做决策时优先遵守上述记忆中的偏好和约束",
    "- 用户说“记住 xxx”时调 remember_user_preference，调完后 reply 里告诉用户记住了什么",
    "- 用户说“别记 xxx”或“忘了 xxx”时先 list_remembered_preferences 找到对应 id，再 forget_user_preference，并在 reply 里告诉用户删了什么",
    "- 如果 remember 返回 similarity conflict，先告诉用户现有条目，问用户是否要替换",
    "- 不要把项目专属内容写进全局记忆；项目上下文已经在 sessions 和聊天历史里"
  ];

  const selected: string[] = [];
  for (const line of lines) {
    const candidate = [...selected, line, "- 更多记忆请用 list_remembered_preferences 查看。"].join("\n");
    if (candidate.length > MAX_PROMPT_CHARS) {
      selected.push("- 更多记忆请用 list_remembered_preferences 查看。");
      break;
    }
    selected.push(line);
  }

  return selected.join("\n");
}

function findMemoryConflict(entries: EsseMemoryEntry[], content: string): EsseMemoryConflict | undefined {
  let best: { entry: EsseMemoryEntry; similarity: number } | undefined;
  for (const entry of entries) {
    const similarity = computeMemorySimilarity(entry.content, content);
    if (similarity >= MEMORY_SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { entry, similarity };
    }
  }

  if (!best) {
    return undefined;
  }

  return {
    conflictsWith: best.entry,
    ok: false,
    similarity: Number(best.similarity.toFixed(2)),
    suggestedNext: `Existing memory: [${best.entry.id}] ${best.entry.content}. To replace it, forget the existing one first then add the new content.`
  };
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　 ]+/g, "")
    .replace(/[，。、；：""''！？「」【】]/g, "")
    .replace(/[,.;:!?"'(){}[\]]/g, "")
    .normalize("NFKC");
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function createMemoryId(existingEntries: EsseMemoryEntry[]): string {
  const existingIds = new Set(existingEntries.map((entry) => entry.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `mem_${randomBytes(4).toString("hex")}`;
    if (!existingIds.has(id)) {
      return id;
    }
  }
  return `mem_${Date.now().toString(16).slice(-8)}`;
}

function isMemoryCategory(value: unknown): value is EsseMemoryCategory {
  return typeof value === "string" && MEMORY_CATEGORIES.includes(value as EsseMemoryCategory);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
