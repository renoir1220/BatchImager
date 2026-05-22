# Project List Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace folder-first project opening with an in-app project list that shows cached 4-6 image previews and can remember external project folders.

**Architecture:** Keep each project as a self-contained folder with `project.sqlite`; add a lightweight global JSON index for remembered project directories. Add thumbnail caching under each project directory and make list loading return metadata plus existing preview paths without synchronously decoding large images.

**Tech Stack:** Electron main IPC, preload bridge, React UI, Vitest, Node `fs/promises`, Node SQLite, `sharp` for async thumbnail generation.

---

### Task 1: Project Metadata And Summary

**Files:**
- Modify: `electron/ipcTypes.ts`
- Modify: `electron/services/projectStore.ts`
- Test: `electron/services/projectStore.test.ts`

- [ ] Add failing tests for default project names, rename persistence, and summary reads.
- [ ] Implement a nullable `name` column on `projects`, return `ProjectMetadata.name`, and derive a Chinese fallback label in service output.
- [ ] Add `renameProject(projectDirectory, name)` and `readProjectSummary(projectDirectory)` helpers.
- [ ] Run `npm test -- electron/services/projectStore.test.ts`.

### Task 2: Remembered Project Index

**Files:**
- Create: `electron/services/projectIndex.ts`
- Create: `electron/services/projectIndex.test.ts`

- [ ] Add failing tests that list default projects, include remembered external directories, de-dupe paths, and mark missing projects unavailable.
- [ ] Implement JSON index read/write helpers using canonical resolved paths.
- [ ] Implement `listProjectEntries({ projectsDirectory, indexFilePath })` with newest-updated sorting.
- [ ] Run `npm test -- electron/services/projectIndex.test.ts`.

### Task 3: Cached Thumbnail Previews

**Files:**
- Create: `electron/services/projectThumbnails.ts`
- Create: `electron/services/projectThumbnails.test.ts`
- Modify: `electron/services/projectStore.ts`

- [ ] Add failing tests that missing thumbnails do not block summary results and generated/current images are preferred over originals.
- [ ] Implement thumbnail path selection from first six sessions.
- [ ] Implement async `ensureProjectThumbnails` using `sharp`, long edge around 260px, safe filenames, and skip existing cache files.
- [ ] Run thumbnail tests without printing source image contents or secrets.

### Task 4: IPC And Renderer API

**Files:**
- Modify: `electron/ipcTypes.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`

- [ ] Add typed request/response interfaces for list/open/remember/rename projects.
- [ ] Add IPC handlers that keep privileged filesystem access in main.
- [ ] Keep legacy folder picker behavior only behind "添加项目文件夹".
- [ ] Push a small refresh event when background thumbnails are ready.

### Task 5: Project List UI

**Files:**
- Create: `src/components/ProjectListDialog.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppToolbar.tsx`
- Modify: `src/styles.css`

- [ ] Add a compact Chinese-first dialog opened by "打开项目".
- [ ] Render each project as a thin-divider row with a 2x3 preview grid, name, image count, updated time, and actions.
- [ ] Add inline rename and "添加项目文件夹" without moving API keys or filesystem access into renderer.
- [ ] Preserve the existing working app as the first screen and keep the log button available.

### Task 6: Full Verification

**Files:**
- All changed files.

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Start the local app and visually inspect the project list dialog.
