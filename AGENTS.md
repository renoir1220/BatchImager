# AGENTS.md

## Project

BatchImager is a Windows/macOS Electron desktop workspace for batch AI product-image generation. Users import rough warehouse or on-site product photos, batch-generate ecommerce-ready images, then refine individual images through a right-side LLM chat session.

This is a real product codebase, not a throwaway demo. Prefer small, testable, production-shaped changes.

## Product Rules

- The UI is Chinese-first.
- The first screen is the working app, not a landing page.
- Images are the primary surface. Avoid decorative chrome.
- Workspace cells are separated by thin dividers, not heavy cards.
- File names and status indicators belong inside the image area.
- Image status tags in the lower-right corner are icon-only.
- The right panel is an image session chat, roughly one quarter of the app width.
- Batch prompts belong in a modal opened by "批量处理", not in the main toolbar.
- Users can continue working while generation jobs run. Do not block the whole app on one image.

## Current Architecture

- `electron/main.ts`: app lifecycle, BrowserWindow, native file picker, custom local-image protocol, IPC handlers.
- `electron/preload.ts`: the only renderer bridge. Keep the exposed API small.
- `electron/services/localConfig.ts`: local `.env.local` and process env parsing for Tuzi/OpenAI-compatible API config.
- `electron/services/tuziImageApi.ts`: image edit API client and generated-image download.
- `electron/services/imageEditInput.ts`: transparent image input preparation before calling the edit API.
- `electron/services/openAiChatApi.ts`: right-side LLM chat and `generate_image` tool execution.
- `electron/services/appLogger.ts`: backend JSONL logging, console logging, and public user-facing log events.
- `src/domain`: pure image-session state helpers.
- `src/components`: React UI components.
- `src/types`: renderer-side shared types.

The renderer must not read API keys or directly access Node filesystem APIs. Route privileged work through preload IPC into the Electron main process.

## Image Edit Input Rules

The user cares about the output size or ratio, not destructive edits to the input. Preserve the input image content as much as possible.

Before calling the image edit API, always use `prepareImageForEditApi`:

- Convert API input to PNG.
- Apply EXIF auto-rotation.
- Keep the original aspect ratio.
- Resize only by equal-proportion scaling.
- Do not crop.
- Do not stretch.
- Do not force square input.
- Do not pad the image unless the product requirement explicitly changes.
- Default maximum long edge is `3840`.
- Default maximum PNG payload is `4 * 1024 * 1024` bytes.
- If the PNG is too large, progressively reduce the long edge while preserving aspect ratio.
- If a PNG is already within byte and long-edge limits, keep it unchanged.

Default generation `size` is derived from the prepared input dimensions, for example `1536x1024`. Do not default to `1024x1024`.

## Output Size Rules

Supported explicit output sizes are:

- `1024x1024`
- `1536x1024`
- `1024x1536`
- `2048x2048`
- `2048x1152`
- `3840x2160`
- `2160x3840`
- `auto`

If the user does not explicitly request an output size or ratio, use `auto` config and let `deriveGenerationSize` send the prepared input dimensions.

In LLM tool use, only pass `size` to `generate_image` when the user clearly asks for a specific size, 2K/4K, square, horizontal, vertical, or a concrete aspect ratio. Otherwise omit `size`.

## LLM Chat And Tool Use

The right-side session chat uses `runImageToolChat`.

- The LLM may call one tool: `generate_image`.
- The tool requires `prompt`.
- The tool may include `size` only when the user explicitly asks for it.
- Do not let the assistant pretend an image was generated. If image generation is needed, use the tool.
- The existing `generateProductImage` function is the single image-generation implementation. Do not create parallel image-generation clients in UI code.
- Tool execution returns local generated-image paths. The renderer displays local files through the custom protocol from preload.

## API And Secrets

- Tuzi/OpenAI-compatible base URL and key are local-only.
- `.env.local` may exist locally and is gitignored.
- Do not log or print API keys.
- Do not move keys into renderer code, Vite env variables, or frontend bundles.
- Image API uses `POST /v1/images/edits`.
- Chat API uses `POST /v1/chat/completions`.

## Logging Rules

- Important generation and chat steps must log through `appLogger`.
- Backend logs should be detailed enough to diagnose stuck jobs: include context, status, dimensions, byte sizes, endpoint names, and errors.
- Public log messages should be short Chinese messages that a non-technical user can understand.
- Do not include API keys or full prompt secrets in logs.
- Keep console output useful with `[BatchImager]` or `[BatchImager UI]` prefixes.
- The toolbar `日志` button opens the real-time log page; keep it available even before images are imported.

## UI Style

Follow `.impeccable.md` and the existing CSS density.

- Compact macOS/Windows desktop feel.
- Avoid oversized web-style controls.
- Avoid landing-page, marketing, or dashboard decoration.
- Do not add unnecessary elements.
- Do not use card-heavy image grids.
- Keep controls small and functional.
- Use Chinese labels.
- Preserve maximum image viewing area.

## Testing And Verification

Use TDD for new behavior when practical. Add or update tests near the changed logic.

Run these before claiming work is complete:

```bash
npm test
npm run typecheck
npm run build
```

For meaningful frontend changes, start the local app and visually inspect the relevant screen. For image API changes, prefer a small local smoke test that does not expose secrets in output.

## Common Pitfalls

- Do not crop or square user input by default.
- Do not assume PNG compression behaves like JPEG quality compression.
- Do not make `1024x1024` the default size.
- Do not add prompt inputs to the toolbar.
- Do not show text inside image status tags.
- Do not bypass `imageEditInput.ts` when calling the edit API.
- Do not duplicate generation logic in the renderer.
- Do not block the whole workspace while one image is generating.
