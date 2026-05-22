import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PersistedImageSession,
  PersistedImageSessionChatMessage,
  ProjectMetadata,
  ProjectSummary,
  ProjectSnapshot
} from "../ipcTypes";

interface CreateProjectOptions {
  makeId?: () => string;
  makeNow?: () => Date;
  projectsDirectory: string;
}

interface ImportProjectImagesDeps {
  copyFile?: typeof copyFile;
  makeNow?: () => Date;
}

interface SaveProjectSnapshotInput {
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
}

interface ProjectRow {
  created_at: string;
  id: string;
  name: string | null;
  updated_at: string;
}

interface ImageSessionRow {
  chat_status: string;
  error_message: string | null;
  file_name: string;
  file_path: string;
  generated_file_path: string | null;
  generated_file_paths_json: string | null;
  id: string;
  last_prompt: string | null;
  show_original_in_list: number;
  status: string;
}

interface ChatMessageRow {
  content: string;
  context_type: string | null;
  generated_file_path: string | null;
  id: string;
  reference_file_paths_json: string | null;
  role: string;
  source_file_path: string | null;
}

interface PreviewSourceRow {
  file_path: string;
  generated_file_path: string | null;
  show_original_in_list: number;
}

const PROJECT_DATABASE_NAME = "project.sqlite";

export async function createProject(options: CreateProjectOptions): Promise<ProjectSnapshot> {
  const now = toIso(options.makeNow?.() ?? new Date());
  const projectId = options.makeId?.() ?? createProjectId(new Date(now));
  const projectDirectory = path.join(options.projectsDirectory, projectId);

  await createProjectDirectories(projectDirectory);

  const db = openProjectDatabase(projectDirectory);
  try {
    initializeSchema(db);
    db.prepare("insert into projects (id, name, created_at, updated_at) values (?, ?, ?, ?)").run(
      projectId,
      formatDefaultProjectName(now),
      now,
      now
    );
  } finally {
    db.close();
  }

  return openProject(projectDirectory);
}

export async function openProject(projectDirectory: string): Promise<ProjectSnapshot> {
  await createProjectDirectories(projectDirectory);

  const db = openProjectDatabase(projectDirectory);
  try {
    initializeSchema(db);
    return readProjectSnapshot(db, projectDirectory);
  } finally {
    db.close();
  }
}

export async function importImagesToProject(
  projectDirectory: string,
  sourcePaths: string[],
  deps: ImportProjectImagesDeps = {}
): Promise<ProjectSnapshot> {
  await createProjectDirectories(projectDirectory);

  const db = openProjectDatabase(projectDirectory);
  try {
    initializeSchema(db);

    const existingSourcePaths = new Set(
      db
        .prepare("select original_source_path from image_sessions where original_source_path is not null")
        .all()
        .map((row) => normalizeSourcePath(String((row as { original_source_path: string }).original_source_path)))
    );
    let nextIndex = getNextImageIndex(db);
    let sortOrder = getNextSortOrder(db);

    for (const sourcePath of sourcePaths) {
      if (!isSupportedImagePath(sourcePath)) {
        continue;
      }

      const normalizedSourcePath = normalizeSourcePath(sourcePath);
      if (existingSourcePaths.has(normalizedSourcePath)) {
        continue;
      }

      existingSourcePaths.add(normalizedSourcePath);
      const sessionId = `img-${nextIndex}`;
      nextIndex += 1;
      const fileName = path.basename(sourcePath);
      const projectFilePath = path.join(projectDirectory, "images", "original", `${sessionId}-${toSafeStem(fileName)}${getLowerExtension(fileName)}`);

      await (deps.copyFile ?? copyFile)(sourcePath, projectFilePath);
      db.prepare(
        `insert into image_sessions (
          id,
          file_path,
          file_name,
          original_source_path,
          status,
          chat_status,
          sort_order
        ) values (?, ?, ?, ?, 'idle', 'idle', ?)`
      ).run(sessionId, projectFilePath, fileName, normalizedSourcePath, sortOrder);
      sortOrder += 1;
    }

    touchProject(db, deps.makeNow?.() ?? new Date());
    return readProjectSnapshot(db, projectDirectory);
  } finally {
    db.close();
  }
}

export async function saveProjectSnapshot(
  projectDirectory: string,
  input: SaveProjectSnapshotInput,
  makeNow: () => Date = () => new Date()
): Promise<ProjectSnapshot> {
  await createProjectDirectories(projectDirectory);

  const db = openProjectDatabase(projectDirectory);
  try {
    initializeSchema(db);
    db.exec("begin immediate transaction");
    try {
      db.prepare("delete from chat_messages").run();
      db.prepare("delete from image_sessions").run();

      input.sessions.forEach((session, index) => {
        db.prepare(
          `insert into image_sessions (
            id,
            file_path,
            file_name,
            original_source_path,
            status,
            chat_status,
            generated_file_path,
            generated_file_paths_json,
            last_prompt,
            error_message,
            show_original_in_list,
            sort_order
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          session.id,
          session.filePath,
          session.fileName,
          normalizeSourcePath(session.filePath),
          session.status,
          session.chatStatus,
          session.generatedFilePath ?? null,
          stringifyOptionalArray(session.generatedFilePaths),
          session.lastPrompt ?? null,
          session.errorMessage ?? null,
          session.showOriginalInList ? 1 : 0,
          index
        );

        session.chatMessages.forEach((message, messageIndex) => {
          db.prepare(
            `insert into chat_messages (
              session_id,
              id,
              role,
              content,
              context_type,
              generated_file_path,
              reference_file_paths_json,
              source_file_path,
              sort_order
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            session.id,
            message.id,
            message.role,
            message.content,
            message.contextType ?? null,
            message.generatedFilePath ?? null,
            stringifyOptionalArray(message.referenceFilePaths),
            message.sourceFilePath ?? null,
            messageIndex
          );
        });
      });

      setProjectState(db, "selectedSessionId", input.selectedSessionId ?? null);
      touchProject(db, makeNow());
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }

    return readProjectSnapshot(db, projectDirectory);
  } finally {
    db.close();
  }
}

export async function renameProject(projectDirectory: string, name: string): Promise<ProjectSnapshot> {
  await createProjectDirectories(projectDirectory);

  const db = openProjectDatabase(projectDirectory);
  try {
    initializeSchema(db);
    const current = readProjectMetadata(db, projectDirectory);
    const nextName = name.trim() || formatDefaultProjectName(current.createdAt);
    db.prepare("update projects set name = ?, updated_at = ?").run(nextName, toIso(new Date()));

    return readProjectSnapshot(db, projectDirectory);
  } finally {
    db.close();
  }
}

export async function readProjectSummary(projectDirectory: string): Promise<ProjectSummary> {
  await createProjectDirectories(projectDirectory);

  const db = openProjectDatabase(projectDirectory);
  try {
    initializeSchema(db);
    return {
      ...readProjectMetadata(db, projectDirectory),
      previewSourcePaths: readProjectPreviewSourcePaths(db)
    };
  } finally {
    db.close();
  }
}

export function getProjectGeneratedDirectory(projectDirectory: string): string {
  return path.join(projectDirectory, "images", "generated");
}

export function getProjectPreparedDirectory(projectDirectory: string): string {
  return path.join(projectDirectory, "images", "prepared");
}

export function getProjectReferencesDirectory(projectDirectory: string): string {
  return path.join(projectDirectory, "references");
}

function openProjectDatabase(projectDirectory: string): DatabaseSync {
  return new DatabaseSync(path.join(projectDirectory, PROJECT_DATABASE_NAME));
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    create table if not exists projects (
      id text primary key,
      name text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists image_sessions (
      id text primary key,
      file_path text not null,
      file_name text not null,
      original_source_path text,
      status text not null,
      chat_status text not null,
      generated_file_path text,
      generated_file_paths_json text,
      last_prompt text,
      error_message text,
      show_original_in_list integer not null default 0,
      sort_order integer not null
    );

    create table if not exists chat_messages (
      session_id text not null,
      id text not null,
      role text not null,
      content text not null,
      context_type text,
      generated_file_path text,
      reference_file_paths_json text,
      source_file_path text,
      sort_order integer not null,
      primary key (session_id, id),
      foreign key (session_id) references image_sessions(id) on delete cascade
    );

    create table if not exists project_state (
      key text primary key,
      value text
    );
  `);

  ensureProjectsNameColumn(db);

  const projectCount = db.prepare("select count(*) as count from projects").get() as { count: number };
  if (projectCount.count === 0) {
    const now = new Date().toISOString();
    db.prepare("insert into projects (id, name, created_at, updated_at) values (?, ?, ?, ?)").run(
      path.basename(process.cwd()),
      formatDefaultProjectName(now),
      now,
      now
    );
  }
}

function ensureProjectsNameColumn(db: DatabaseSync): void {
  const columns = db.prepare("pragma table_info(projects)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "name")) {
    db.exec("alter table projects add column name text");
  }
}

async function createProjectDirectories(projectDirectory: string): Promise<void> {
  await Promise.all([
    mkdir(getProjectGeneratedDirectory(projectDirectory), { recursive: true }),
    mkdir(getProjectPreparedDirectory(projectDirectory), { recursive: true }),
    mkdir(getProjectReferencesDirectory(projectDirectory), { recursive: true }),
    mkdir(path.join(projectDirectory, "images", "original"), { recursive: true })
  ]);
}

function readProjectSnapshot(db: DatabaseSync, projectDirectory: string): ProjectSnapshot {
  const sessions = (db.prepare("select * from image_sessions order by sort_order asc").all() as unknown as ImageSessionRow[]).map((row) =>
    mapSessionRow(db, row)
  );

  return {
    project: readProjectMetadata(db, projectDirectory, sessions.length),
    selectedSessionId: getProjectState(db, "selectedSessionId"),
    sessions
  };
}

function readProjectMetadata(db: DatabaseSync, projectDirectory: string, imageCount?: number): ProjectMetadata {
  const projectRow = db.prepare("select id, name, created_at, updated_at from projects order by created_at asc limit 1").get() as unknown as ProjectRow;
  const count =
    imageCount ??
    ((db.prepare("select count(*) as count from image_sessions").get() as { count: number }).count);

  return {
    createdAt: projectRow.created_at,
    directory: projectDirectory,
    id: projectRow.id,
    imageCount: count,
    name: projectRow.name?.trim() || formatDefaultProjectName(projectRow.created_at),
    updatedAt: projectRow.updated_at
  };
}

function readProjectPreviewSourcePaths(db: DatabaseSync): string[] {
  return (db.prepare(
    `select file_path, generated_file_path, show_original_in_list
      from image_sessions
      order by sort_order asc
      limit 6`
  ).all() as unknown as PreviewSourceRow[]).map((row) =>
    row.generated_file_path && !row.show_original_in_list ? row.generated_file_path : row.file_path
  );
}

function mapSessionRow(db: DatabaseSync, row: ImageSessionRow): PersistedImageSession {
  const chatMessages = db
    .prepare("select * from chat_messages where session_id = ? order by sort_order asc")
    .all(row.id)
    .map((messageRow) => mapMessageRow(messageRow as unknown as ChatMessageRow));

  return removeUndefined({
    chatMessages,
    chatStatus: row.chat_status as PersistedImageSession["chatStatus"],
    errorMessage: row.error_message ?? undefined,
    fileName: row.file_name,
    filePath: row.file_path,
    generatedFilePath: row.generated_file_path ?? undefined,
    generatedFilePaths: parseOptionalArray(row.generated_file_paths_json),
    id: row.id,
    lastPrompt: row.last_prompt ?? undefined,
    showOriginalInList: Boolean(row.show_original_in_list),
    status: row.status as PersistedImageSession["status"]
  });
}

function mapMessageRow(row: ChatMessageRow): PersistedImageSessionChatMessage {
  return removeUndefined({
    content: row.content,
    contextType: (row.context_type ?? undefined) as PersistedImageSessionChatMessage["contextType"],
    generatedFilePath: row.generated_file_path ?? undefined,
    id: row.id,
    referenceFilePaths: parseOptionalArray(row.reference_file_paths_json),
    role: row.role as PersistedImageSessionChatMessage["role"],
    sourceFilePath: row.source_file_path ?? undefined
  });
}

function getNextImageIndex(db: DatabaseSync): number {
  const row = db.prepare("select id from image_sessions").all() as Array<{ id: string }>;
  const max = row.reduce((highest, current) => {
    const match = /^img-(\d+)$/.exec(current.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return max + 1;
}

function getNextSortOrder(db: DatabaseSync): number {
  const row = db.prepare("select coalesce(max(sort_order), -1) + 1 as next from image_sessions").get() as { next: number };
  return row.next;
}

function getProjectState(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("select value from project_state where key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

function setProjectState(db: DatabaseSync, key: string, value: string | null): void {
  db.prepare("insert into project_state (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
}

function touchProject(db: DatabaseSync, date: Date): void {
  db.prepare("update projects set updated_at = ?").run(toIso(date));
}

function createProjectId(date: Date): string {
  return `project-${date.toISOString().replace(/[:.]/g, "-")}`;
}

function isSupportedImagePath(filePath: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(filePath);
}

function getLowerExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase() || ".png";
}

function normalizeSourcePath(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

function parseOptionalArray(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
}

function stringifyOptionalArray(value: string[] | undefined): string | null {
  return value?.length ? JSON.stringify(value) : null;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function formatDefaultProjectName(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "当前项目";
  }

  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  return `项目 ${month}-${day} ${hour}:${minute}`;
}

function toSafeStem(fileName: string): string {
  return (
    path
      .basename(fileName, path.extname(fileName))
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "image"
  );
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
