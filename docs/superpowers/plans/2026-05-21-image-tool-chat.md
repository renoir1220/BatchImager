# Image Tool Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable right-side LLM chat where image generation is executed through a `generate_image` tool call.

**Architecture:** Electron main owns Tuzi/OpenAI-compatible chat calls and tool execution. Renderer owns in-memory message display and sends only local image context and prior messages over IPC. Existing image generation remains the single image tool implementation.

**Tech Stack:** Electron, React, TypeScript, Vitest, OpenAI-compatible `/v1/chat/completions`.

---

## File Structure

- Create `electron/services/openAiChatApi.ts`: chat endpoint builder, response parser, tool-call loop orchestration.
- Create `electron/services/openAiChatApi.test.ts`: TDD coverage for endpoint building, tool call parsing, and image tool execution loop.
- Modify `electron/services/localConfig.ts`: resolve shared Tuzi credentials plus `TUZI_LLM_MODEL`.
- Modify `electron/ipcTypes.ts`: add chat request/response and message types.
- Modify `electron/main.ts`: register `chat:send-message` IPC and call the chat service.
- Modify `electron/preload.ts` and `src/vite-env.d.ts`: expose `sendChatMessage`.
- Modify `src/types/image.ts`, `src/domain/imageSessions.ts`, and tests: store chat messages and chat status per image session.
- Modify `src/App.tsx` and `src/components/SessionPanel.tsx`: render transcript and send messages through the new IPC.
- Modify `src/styles.css`: compact desktop chat styling.

## Tasks

- [ ] Write failing tests for shared Tuzi config resolving `TUZI_LLM_MODEL`.
- [ ] Implement local config changes and confirm tests pass.
- [ ] Write failing tests for OpenAI-compatible chat endpoint, tool-call parsing, and tool execution loop.
- [ ] Implement `openAiChatApi.ts` until tests pass.
- [ ] Write failing domain tests for user/assistant/error chat message updates.
- [ ] Implement domain chat state helpers until tests pass.
- [ ] Wire IPC and preload types.
- [ ] Replace right-side prompt panel with chat transcript and composer.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Start the app and inspect the right-side chat UI.

