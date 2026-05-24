import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  RUN_ESSE_LLM_EVAL: "1"
};

const smoke = spawnSync(
  "vitest",
  ["run", "electron/services/esseLlmSmoke.llm.test.ts", "--testTimeout=80000"],
  {
    env,
    shell: process.platform === "win32",
    stdio: "inherit"
  }
);

if (smoke.status !== 0) {
  console.error("[BatchImager eval] Real LLM smoke failed; skipping workspace LLM scenarios because the LLM API/runtime did not return a minimal prompt in time.");
  process.exit(smoke.status ?? 1);
}

const result = spawnSync(
  "vitest",
  ["run", "electron/services/esseWorkspaceAgent.llm.test.ts", "--testTimeout=180000"],
  {
    env,
    shell: process.platform === "win32",
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);
