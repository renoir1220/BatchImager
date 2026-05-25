import path from "node:path";
import { describe, expect, test } from "vitest";
import { createBatchImagerCommandPolicy } from "./agentCommandPolicy";

describe("agentCommandPolicy", () => {
  const projectDirectory = path.resolve("C:\\BatchImagerProjects\\project-1");
  const policy = createBatchImagerCommandPolicy({ projectDirectory });

  test("allows ordinary project commands by default", () => {
    expect(policy.checkCommand("npm test").allowed).toBe(true);
    expect(policy.checkCommand("npm run build").allowed).toBe(true);
    expect(policy.checkCommand("git status --short").allowed).toBe(true);
    expect(policy.checkCommand("Remove-Item -Recurse .\\dist").allowed).toBe(true);
  });

  test.each([
    "shutdown /s /t 0",
    "Restart-Computer -Force",
    "Format-Volume -DriveLetter D",
    "reg delete HKCU\\Software\\BatchImager /f",
    "schtasks /create /tn test /tr calc.exe /sc once",
    "icacls C:\\Users\\ldy /grant Everyone:F",
    "takeown /f C:\\Users\\ldy /r",
    "taskkill /f /im explorer.exe"
  ])("denies system-level destructive command: %s", (command) => {
    const decision = policy.checkCommand(command);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("系统级危险命令");
  });

  test.each(["rm -rf /", "rm -rf C:\\Users\\ldy", "Remove-Item -Recurse C:\\Users\\ldy"])(
    "denies recursive deletion of root or user directories: %s",
    (command) => {
      const decision = policy.checkCommand(command);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("递归删除");
    }
  );

  test("denies destructive shell operations targeting protected image directories", () => {
    const originalPath = path.join(projectDirectory, "images", "original");
    const referencePath = path.join(projectDirectory, "references", "room.png");

    expect(policy.checkCommand(`rm -rf "${originalPath}"`).allowed).toBe(false);
    expect(policy.checkCommand(`del /s "${referencePath}"`).allowed).toBe(false);
    expect(policy.checkCommand(`Move-Item "${referencePath}" "${path.join(projectDirectory, "trash", "room.png")}"`).allowed).toBe(false);
  });

  test("allows deleting generated outputs and build artifacts inside the project", () => {
    expect(policy.checkCommand(`rm -rf "${path.join(projectDirectory, "images", "generated", "old")}"`).allowed).toBe(true);
    expect(policy.checkCommand(`Remove-Item -Recurse "${path.join(projectDirectory, "dist")}"`).allowed).toBe(true);
  });

  test.each([
    "sqlite3 project.sqlite \".tables\"",
    `sqlite3 "${path.join(projectDirectory, "project.sqlite")}" "select * from image_sessions"`,
    "echo ok && sqlite3 project.sqlite \"select id from image_sessions\""
  ])("denies sqlite inspection of BatchImager project state: %s", (command) => {
    const decision = policy.checkCommand(command);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("项目数据库");
    expect(decision.suggestion).toContain("list_sessions");
  });

  test("allows pipelines whose every segment is safe", () => {
    expect(policy.checkCommand("git status --short | grep modified").allowed).toBe(true);
    expect(policy.checkCommand("npm run build && npm test").allowed).toBe(true);
  });

  test.each([
    "git status; shutdown /s /t 0",
    "git status && rm -rf /",
    "ls || Format-Volume -DriveLetter D",
    "git log | taskkill /f /im explorer.exe",
    "git status & shutdown /s /t 0"
  ])("denies the whole pipeline when any segment is dangerous: %s", (command) => {
    expect(policy.checkCommand(command).allowed).toBe(false);
  });

  test.each([
    "echo $(rm -rf /)",
    "echo `shutdown /s /t 0`",
    "git log --pretty=$(taskkill /f /im explorer.exe)"
  ])("denies commands that smuggle dangerous calls through command substitution: %s", (command) => {
    const decision = policy.checkCommand(command);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("命令替换");
  });

  test.each([
    "echo $(shutdown /s $(date))",
    "echo $(echo $(taskkill /f /im explorer.exe))",
    "git log $(echo $(rm -rf /))"
  ])("denies dangerous calls hidden inside nested command substitution: %s", (command) => {
    const decision = policy.checkCommand(command);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("命令替换");
  });
});
