# Image Tool Chat Design

## Goal

Make the right-side image session a real LLM conversation driven by an OpenAI-compatible chat completions API. Image generation is exposed to the LLM as a `generate_image` tool, executed by the Electron main process.

## Architecture

The renderer sends a user message, selected image path, and visible session history through IPC. The Electron main process calls `POST /v1/chat/completions` using the same Tuzi base URL and API key used by the image API, plus a separate `TUZI_LLM_MODEL` setting. It declares a single `generate_image` tool with a required `prompt` argument.

When the model returns a `tool_call`, main validates the call, invokes the existing `generateProductImage`, appends a `tool` result message, and asks the LLM for a final assistant response. The renderer receives assistant text plus an optional generated image path and updates the selected session.

## Scope

- Right-side single-image chat uses LLM tool calling.
- Existing batch generation can keep direct image generation for now.
- API credentials remain main-process only.
- Chat history is in-memory per imported image session.

## Error Handling

Invalid LLM responses, unsupported tool names, malformed tool arguments, image generation errors, and non-OK API responses return clear assistant-visible errors to the renderer. The UI keeps the user message in history and adds an error row without losing the current image.

