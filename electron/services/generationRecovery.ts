import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type GenerationJobMode = "edit" | "generate";
type GenerationJobStage = "requesting" | "remote-received" | "completed" | "failed";

interface GenerationJobRow {
  error_message: string | null;
  image_path: string | null;
  mode: GenerationJobMode;
  output_path: string | null;
  prompt: string;
  reference_image_paths_json: string | null;
  remote_url: string | null;
  request_size: string | null;
  session_id: string;
  size: string | null;
  stage: GenerationJobStage;
  updated_at: string;
}

interface StartGenerationJobInput {
  imagePath?: string;
  mode: GenerationJobMode;
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  size?: string;
}

interface RemoteReceivedInput {
  remoteUrl?: string;
  requestSize: string;
  sessionId: string;
}

interface CompletedInput {
  outputPath: string;
  sessionId: string;
}

interface FailedInput {
  errorMessage: string;
  sessionId: string;
}

interface RecoverDeps {
  fetch?: typeof fetch;
  makeNow?: () => Date;
  writeFile?: typeof writeFile;
}

interface RecoverResult {
  completed: number;
  failed: number;
}

const PROJECT_DATABASE_NAME = "project.sqlite";

export async function startGenerationJob(projectDirectory: string, input: StartGenerationJobInput): Promise<void> {
  const db = openProjectDatabase(projectDirectory);
  try {
    initializeGenerationJobSchema(db);
    db.prepare(
      `insert into generation_jobs (
        session_id,
        mode,
        image_path,
        prompt,
        reference_image_paths_json,
        size,
        stage,
        remote_url,
        request_size,
        output_path,
        error_message,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, 'requesting', null, null, null, null, ?)
      on conflict(session_id) do update set
        mode = excluded.mode,
        image_path = excluded.image_path,
        prompt = excluded.prompt,
        reference_image_paths_json = excluded.reference_image_paths_json,
        size = excluded.size,
        stage = 'requesting',
        remote_url = null,
        request_size = null,
        output_path = null,
        error_message = null,
        updated_at = excluded.updated_at`
    ).run(
      input.sessionId,
      input.mode,
      input.imagePath ?? null,
      input.prompt,
      stringifyOptionalArray(input.referenceImagePaths),
      input.size ?? null,
      new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

export async function markGenerationJobRemoteReceived(projectDirectory: string, input: RemoteReceivedInput): Promise<void> {
  const db = openProjectDatabase(projectDirectory);
  try {
    initializeGenerationJobSchema(db);
    db.prepare(
      `update generation_jobs
        set stage = 'remote-received',
            remote_url = ?,
            request_size = ?,
            error_message = null,
            updated_at = ?
        where session_id = ?`
    ).run(input.remoteUrl ?? null, input.requestSize, new Date().toISOString(), input.sessionId);
  } finally {
    db.close();
  }
}

export async function markGenerationJobCompleted(projectDirectory: string, input: CompletedInput): Promise<void> {
  const db = openProjectDatabase(projectDirectory);
  try {
    initializeGenerationJobSchema(db);
    db.prepare(
      `update generation_jobs
        set stage = 'completed',
            output_path = ?,
            error_message = null,
            updated_at = ?
        where session_id = ?`
    ).run(input.outputPath, new Date().toISOString(), input.sessionId);
  } finally {
    db.close();
  }
}

export async function markGenerationJobFailed(projectDirectory: string, input: FailedInput): Promise<void> {
  const db = openProjectDatabase(projectDirectory);
  try {
    initializeGenerationJobSchema(db);
    db.prepare(
      `update generation_jobs
        set stage = 'failed',
            error_message = ?,
            updated_at = ?
        where session_id = ?`
    ).run(input.errorMessage, new Date().toISOString(), input.sessionId);
  } finally {
    db.close();
  }
}

export async function recoverInterruptedGenerationJobs(
  projectDirectory: string,
  deps: RecoverDeps = {}
): Promise<RecoverResult> {
  const db = openProjectDatabase(projectDirectory);
  try {
    initializeGenerationJobSchema(db);
    const jobs = db
      .prepare("select * from generation_jobs where stage in ('requesting', 'remote-received') order by updated_at asc")
      .all() as unknown as GenerationJobRow[];
    let completed = 0;
    let failed = 0;

    for (const job of jobs) {
      if (!sessionIsStillGenerating(db, job.session_id)) {
        continue;
      }

      if (!job.remote_url) {
        failInterruptedJob(db, job.session_id, "上次生成中断，未拿到可恢复的图片地址。请重试。");
        failed += 1;
        continue;
      }

      try {
        const outputPath = await downloadRecoveredImage(projectDirectory, job, deps);
        completeRecoveredJob(db, job, outputPath);
        completed += 1;
      } catch (error) {
        failInterruptedJob(db, job.session_id, `恢复下载失败：${toErrorMessage(error)}。请重试。`);
        failed += 1;
      }
    }

    return { completed, failed };
  } finally {
    db.close();
  }
}

function initializeGenerationJobSchema(db: DatabaseSync): void {
  db.exec(`
    create table if not exists generation_jobs (
      session_id text primary key,
      mode text not null,
      image_path text,
      prompt text not null,
      reference_image_paths_json text,
      size text,
      stage text not null,
      remote_url text,
      request_size text,
      output_path text,
      error_message text,
      updated_at text not null
    );
  `);
}

function openProjectDatabase(projectDirectory: string): DatabaseSync {
  return new DatabaseSync(path.join(projectDirectory, PROJECT_DATABASE_NAME));
}

function sessionIsStillGenerating(db: DatabaseSync, sessionId: string): boolean {
  const row = db.prepare("select status from image_sessions where id = ?").get(sessionId) as { status: string } | undefined;
  return row?.status === "generating" || row?.status === "queued";
}

async function downloadRecoveredImage(projectDirectory: string, job: GenerationJobRow, deps: RecoverDeps): Promise<string> {
  const fetchImpl = deps.fetch ?? fetch;
  const response = await fetchImpl(job.remote_url ?? "");

  if (!response.ok) {
    throw new Error(`下载返回 ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const outputDirectory = path.join(projectDirectory, "images", "generated");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${toSafeName(job.session_id)}-${toTimestamp(deps.makeNow?.() ?? new Date())}.png`);
  await (deps.writeFile ?? writeFile)(outputPath, bytes);
  return outputPath;
}

function completeRecoveredJob(db: DatabaseSync, job: GenerationJobRow, outputPath: string): void {
  const current = db
    .prepare("select generated_file_paths_json from image_sessions where id = ?")
    .get(job.session_id) as { generated_file_paths_json: string | null } | undefined;
  const generatedFilePaths = appendGeneratedFilePath(parseOptionalArray(current?.generated_file_paths_json ?? null), outputPath);

  db.prepare(
    `update image_sessions
      set status = 'completed',
          error_message = null,
          generated_file_path = ?,
          generated_file_paths_json = ?,
          show_original_in_list = 0
      where id = ?`
  ).run(outputPath, JSON.stringify(generatedFilePaths), job.session_id);
  db.prepare(
    `insert or ignore into chat_messages (
      session_id,
      id,
      role,
      content,
      context_type,
      generated_file_path,
      sort_order
    ) values (?, ?, 'context', '恢复完成，已加入会话上下文。', 'generated-image', ?, (select coalesce(max(sort_order), -1) + 1 from chat_messages where session_id = ?))`
  ).run(job.session_id, `recovered-${outputPath}`, outputPath, job.session_id);
  db.prepare(
    `update generation_jobs
      set stage = 'completed',
          output_path = ?,
          error_message = null,
          updated_at = ?
      where session_id = ?`
  ).run(outputPath, new Date().toISOString(), job.session_id);
}

function failInterruptedJob(db: DatabaseSync, sessionId: string, errorMessage: string): void {
  db.prepare(
    `update image_sessions
      set status = 'failed',
          chat_status = 'idle',
          error_message = ?
      where id = ?`
  ).run(errorMessage, sessionId);
  db.prepare(
    `update generation_jobs
      set stage = 'failed',
          error_message = ?,
          updated_at = ?
      where session_id = ?`
  ).run(errorMessage, new Date().toISOString(), sessionId);
}

function parseOptionalArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function stringifyOptionalArray(value: string[] | undefined): string | null {
  return value?.length ? JSON.stringify(value) : null;
}

function appendGeneratedFilePath(existing: string[], generatedFilePath: string): string[] {
  return [...existing.filter((filePath) => filePath !== generatedFilePath), generatedFilePath];
}

function toSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

function toTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
