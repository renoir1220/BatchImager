import { describe, expect, test } from "vitest";
import { createAgentRuntime, type CodingAgentSdk } from "./agentRuntime";
import { loadTuziLlmConfig } from "./localConfig";

const RUN_LLM_EVAL = process.env.RUN_ESSE_LLM_EVAL === "1";

describe.skipIf(!RUN_LLM_EVAL)("Esse real LLM smoke", () => {
  test("returns a minimal response without custom tools", async () => {
    const config = loadTuziLlmConfig();
    const runtime = await withSmokeTimeout(
      "create runtime",
      createAgentRuntime({
        llmConfig: config,
        model: config.model,
        projectDirectory: process.cwd(),
        sdk: (await import("@earendil-works/pi-coding-agent")) as CodingAgentSdk,
        sessionId: "esse-llm-smoke"
      }),
      20_000
    );

    try {
      await withSmokeTimeout("minimal prompt", runtime.prompt("请只回复：OK"), 45_000);
      expect(runtime.getLastAssistantText()?.trim()).toContain("OK");
    } finally {
      runtime.dispose();
    }
  }, 80_000);
});

async function withSmokeTimeout<T>(label: string, run: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`LLM smoke timed out during ${label} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([run, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
