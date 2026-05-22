import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createBatchImagerPermissionPolicy,
  type AgentFileOperation
} from "./agentPermissionPolicy";

describe("agentPermissionPolicy", () => {
  const projectDirectory = path.resolve("C:\\BatchImagerProjects\\project-1");
  const policy = createBatchImagerPermissionPolicy({ projectDirectory });

  test("allows broad project reads including protected user image assets", () => {
    expectDecision(
      policy.checkFileOperation({
        operation: "read",
        path: path.join(projectDirectory, "images", "original", "img-1-flower.jpg")
      }),
      "allow"
    );
    expectDecision(
      policy.checkFileOperation({
        operation: "read",
        path: path.join(projectDirectory, "references", "room.png")
      }),
      "allow"
    );
  });

  test("allows writes inside normal project working directories", () => {
    expectDecision(
      policy.checkFileOperation({
        operation: "write",
        path: path.join(projectDirectory, "agent", "notes.md")
      }),
      "allow"
    );
    expectDecision(
      policy.checkFileOperation({
        operation: "write",
        path: path.join(projectDirectory, "images", "generated", "img-1.png")
      }),
      "allow"
    );
  });

  test.each<AgentFileOperation>(["write", "delete", "rename", "overwrite"])(
    "denies %s operations on imported original images",
    (operation) => {
      const decision = policy.checkFileOperation({
        operation,
        path: path.join(projectDirectory, "images", "original", "img-1-flower.jpg")
      });

      expect(decision).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("原始图片")
      });
      expect(decision.suggestion).toContain("generated");
    }
  );

  test.each<AgentFileOperation>(["write", "delete", "rename", "overwrite"])(
    "denies %s operations on reference images",
    (operation) => {
      const decision = policy.checkFileOperation({
        operation,
        path: path.join(projectDirectory, "references", "room.png")
      });

      expect(decision).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("参考图")
      });
    }
  );

  test("denies writes outside the project by default but allows registered external write roots", () => {
    const outsidePath = path.resolve("C:\\Users\\ldy\\Desktop\\result.png");
    expectDecision(policy.checkFileOperation({ operation: "write", path: outsidePath }), "deny");

    const externalPolicy = createBatchImagerPermissionPolicy({
      externalWriteRoots: [path.resolve("C:\\Users\\ldy\\Desktop\\exports")],
      projectDirectory
    });

    expectDecision(
      externalPolicy.checkFileOperation({
        operation: "write",
        path: path.resolve("C:\\Users\\ldy\\Desktop\\exports\\result.png")
      }),
      "allow"
    );
  });

  test("allows external reads so the agent can inspect explicitly referenced files", () => {
    expectDecision(
      policy.checkFileOperation({
        operation: "read",
        path: path.resolve("C:\\Users\\ldy\\Pictures\\sample.jpg")
      }),
      "allow"
    );
  });
});

function expectDecision(decision: { allowed: boolean }, expected: "allow" | "deny"): void {
  expect(decision.allowed).toBe(expected === "allow");
}
