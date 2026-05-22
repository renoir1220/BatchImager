# Pi Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first lightweight BatchImager agent runtime foundation using Pi-style embedded sessions, OpenClaw-style tool policy, and broad project permissions.

**Architecture:** Keep the current chat/image generation path stable while adding a small agent layer in Electron main. Permission logic lives outside the LLM as pure services, then Pi integration calls through those services before any tool executes.

**Tech Stack:** Electron main process, TypeScript, Vitest, `@earendil-works/pi-coding-agent` loaded dynamically.

---

### Task 1: Permission Policy Core

**Files:**
- Create: `electron/services/agentPermissionPolicy.ts`
- Test: `electron/services/agentPermissionPolicy.test.ts`

- [ ] Define a project-scoped path policy.
- [ ] Allow reads broadly, including imported original images and reference images.
- [ ] Allow writes inside the project except protected user asset directories.
- [ ] Deny delete/overwrite/rename operations on `images/original` and `references`.
- [ ] Deny writes outside the project unless the path is explicitly registered as an external write root.
- [ ] Return clear Chinese-facing denial messages with suggested alternatives.

### Task 2: Command Guard

**Files:**
- Create: `electron/services/agentCommandPolicy.ts`
- Test: `electron/services/agentCommandPolicy.test.ts`

- [ ] Allow normal project commands by default.
- [ ] Deny catastrophic system commands such as format, shutdown/restart, registry edits, permission takeover, scheduled task creation, and root/home recursive deletion.
- [ ] Deny destructive shell operations targeting protected image directories.
- [ ] Keep denials narrow so the agent does not loop on harmless project work.

### Task 3: Pi Runtime Adapter

**Files:**
- Create: `electron/services/piAgentRuntime.ts`
- Test: `electron/services/piAgentRuntime.test.ts`

- [ ] Dynamically load Pi so the app can report a clear error if the dependency is unavailable.
- [ ] Build a minimal session descriptor with project cwd, session id, model metadata, enabled built-in tools, and custom BatchImager tool names.
- [ ] Expose a runtime availability check and event mapping placeholders without replacing current chat yet.

### Task 4: Dependency And Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add `@earendil-works/pi-coding-agent`.
- [ ] Run focused tests during implementation.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build` before handoff.
