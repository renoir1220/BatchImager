import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const DEV_SERVER_PORT = "15173";

describe("dev server port configuration", () => {
  test("keeps Vite, Electron, and kdev on the high dev port", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const electronMainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const killPortSource = readFileSync(path.resolve(process.cwd(), "scripts/kill-port.mjs"), "utf8");

    expect(packageJson.scripts.dev).toContain(`--port ${DEV_SERVER_PORT}`);
    expect(packageJson.scripts.dev).toContain(`http://127.0.0.1:${DEV_SERVER_PORT}`);
    expect(packageJson.scripts.kdev).toContain(`kill-port.mjs ${DEV_SERVER_PORT}`);
    expect(electronMainSource).toContain(`http://127.0.0.1:${DEV_SERVER_PORT}`);
    expect(killPortSource).toContain(`process.argv[2] ?? ${DEV_SERVER_PORT}`);
  });
});
