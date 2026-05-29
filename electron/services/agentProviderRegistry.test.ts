import { describe, expect, test } from "vitest";
import type { AgentProviderDescriptor, SendAgentMessageRequest, SendEsseMessageRequest } from "../ipcTypes";
import { createAgentProviderRegistry } from "./agentProviderRegistry";

const esseDescriptor: AgentProviderDescriptor = {
  description: "Esse provider",
  id: "esse",
  label: "Esse",
  shortLabel: "Esse",
  status: "available",
  supportsPersona: true,
  workbenchCapabilityIds: ["list_sessions"]
};

describe("agentProviderRegistry", () => {
  test("dispatches a generic agent message to the registered provider runner", async () => {
    const received: Array<{ context: string; request: SendEsseMessageRequest }> = [];
    const registry = createAgentProviderRegistry<string>([
      {
        descriptor: esseDescriptor,
        run: async (request, context) => {
          received.push({ context, request });
          return { reply: "好的" };
        }
      }
    ]);

    const result = await registry.dispatchMessage(createAgentRequest(), "ipc-context");

    expect(result).toEqual({ providerId: "esse", reply: "好的" });
    expect(received).toEqual([
      {
        context: "ipc-context",
        request: expect.not.objectContaining({ providerId: "esse" })
      }
    ]);
    expect(received[0]?.request.messages[0]?.content).toBe("整理这些图片");
  });

  test("lists cloned descriptors so callers cannot mutate registry state", () => {
    const registry = createAgentProviderRegistry([{ descriptor: esseDescriptor, run: async () => ({ reply: "ok" }) }]);

    const listedProviders = registry.listProviders();
    listedProviders[0]!.label = "Changed";
    listedProviders[0]!.workbenchCapabilityIds.push("mutated");

    expect(registry.listProviders()[0]?.label).toBe("Esse");
    expect(registry.listProviders()[0]?.workbenchCapabilityIds).toEqual(["list_sessions"]);
  });

  test("rejects unknown or unavailable providers before running a turn", async () => {
    const unavailableDescriptor: AgentProviderDescriptor = {
      ...esseDescriptor,
      status: "coming-soon"
    };
    const registry = createAgentProviderRegistry([
      {
        descriptor: unavailableDescriptor,
        run: async () => {
          throw new Error("should not run");
        }
      }
    ]);

    await expect(registry.dispatchMessage(createAgentRequest(), undefined)).rejects.toThrow("Agent provider is not available: Esse");

    const emptyRegistry = createAgentProviderRegistry([]);
    await expect(
      emptyRegistry.dispatchMessage({ ...createAgentRequest(), providerId: "codex" }, undefined)
    ).rejects.toThrow("Unsupported agent provider: codex");
  });

  test("rejects duplicate provider ids at construction time", () => {
    expect(() =>
      createAgentProviderRegistry([
        { descriptor: esseDescriptor, run: async () => ({ reply: "one" }) },
        { descriptor: esseDescriptor, run: async () => ({ reply: "two" }) }
      ])
    ).toThrow("Duplicate agent provider: esse");
  });
});

function createAgentRequest(): SendAgentMessageRequest {
  return {
    messages: [{ content: "整理这些图片", role: "user" }],
    providerId: "esse",
    sessions: [{ fileName: "a.png", id: "sess_1" }]
  };
}
