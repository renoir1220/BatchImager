# Local Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit local projects so each batch keeps its own images, generated outputs, and chat history.

**Architecture:** Electron main owns project files, SQLite persistence, and privileged filesystem operations. Renderer loads and mutates project snapshots through a small preload API, while existing domain helpers continue to update image session state locally.

**Tech Stack:** Electron, React, TypeScript, Vitest, Node `node:sqlite`, local filesystem storage.

---

## File Structure

- Create `electron/services/projectStore.ts`: local project directory creation/opening, SQLite schema, image import copying, snapshot read/write helpers.
- Create `electron/services/projectStore.test.ts`: storage behavior tests with temp directories and SQLite.
- Modify `electron/ipcTypes.ts`: add project snapshot, metadata, import, open/create IPC types.
- Modify `electron/main.ts`: add project IPC handlers and route generated/reference/prepared image paths into the active project.
- Modify `electron/preload.ts` and `src/vite-env.d.ts`: expose a compact project API.
- Modify `src/App.tsx`: require an active project before import, load snapshots, persist session changes, and pass project controls to toolbar/empty state.
- Modify `src/components/AppToolbar.tsx`: add compact Chinese project controls.
- Modify `src/components/EmptyWorkspace.tsx`: show project-aware empty state.
- Modify `src/styles.css`: preserve desktop density while adding project controls.

## Tasks

- [ ] Write failing tests for project creation, image import copying, duplicate detection, and session snapshot persistence.
- [ ] Implement `projectStore.ts` until storage tests pass.
- [ ] Add project IPC/preload types and main handlers.
- [ ] Wire renderer project loading, importing, and state persistence.
- [ ] Route reference and generated images into current project folders.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Commit feature branch and merge it into `main`.

