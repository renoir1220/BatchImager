# Initial Electron Image Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-grade BatchImager desktop frame with multi-image import, drag-and-drop import, and a dense image workspace.

**Architecture:** Electron owns native file selection and application lifecycle. The preload bridge exposes a narrow API to React. Pure domain functions create and deduplicate image sessions so core behavior can be tested without Electron.

**Tech Stack:** Electron, Vite, React, TypeScript, Vitest, CSS.

---

## File Structure

- `package.json`: scripts, runtime dependencies, development dependencies.
- `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`: TypeScript and Vite configuration.
- `index.html`: renderer mount point.
- `electron/main.ts`: Electron app lifecycle, window creation, image file dialog IPC.
- `electron/preload.ts`: safe renderer bridge for image selection.
- `src/types/image.ts`: image session and import types.
- `src/domain/imageFiles.ts`: image extension filtering and file deduplication.
- `src/domain/imageSessions.ts`: image session creation and selection helpers.
- `src/domain/*.test.ts`: Vitest coverage for domain behavior.
- `src/App.tsx`: application shell and state orchestration.
- `src/components/*`: focused UI components for toolbar, workspace, image cell, session panel, and empty state.
- `src/styles.css`: desktop-density Chinese UI styling.
- `src/main.tsx`: React entry point.
- `src/vite-env.d.ts`: Vite and preload typing.

## Task 1: Project Scaffold

- [ ] Initialize npm metadata and install Electron, Vite, React, TypeScript, Vitest, and supporting packages.
- [ ] Create TypeScript, Vite, Electron, and renderer entry files.
- [ ] Add scripts: `dev`, `build`, `test`, `typecheck`.
- [ ] Verify `npm run typecheck` reaches real project code.

## Task 2: Domain Tests First

- [ ] Write failing tests for supported image extension detection.
- [ ] Write failing tests for filtering duplicate paths.
- [ ] Write failing tests for creating image sessions with stable ids and initial selection.
- [ ] Run tests and confirm they fail because production domain modules are missing.

## Task 3: Domain Implementation

- [ ] Implement `isSupportedImagePath`, `dedupeImageFiles`, and `createImageSessions`.
- [ ] Run domain tests and confirm they pass.
- [ ] Keep the domain independent from Electron and React.

## Task 4: Electron Bridge

- [ ] Implement main process window creation.
- [ ] Implement `images:select` IPC using `dialog.showOpenDialog` with multi-select image filters.
- [ ] Implement preload bridge `window.batchImager.selectImages()`.
- [ ] Type the bridge in `src/vite-env.d.ts`.

## Task 5: Renderer UI

- [ ] Implement Chinese toolbar with `导入`, `列数`, and `批量处理`.
- [ ] Implement drag-and-drop import over the workspace.
- [ ] Implement dense N-column image grid using 1px hairline dividers.
- [ ] Put filename and icon-only status affordances inside image cells.
- [ ] Implement right-side `会话` panel for the selected image.
- [ ] Keep `批量处理` present but disabled or clearly unavailable until generation is implemented.

## Task 6: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Start the local dev app and inspect the renderer in browser/Electron where feasible.
