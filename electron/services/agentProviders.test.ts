import { describe, expect, test } from "vitest";
import { DEFAULT_AGENT_PROVIDER_ID, getAgentProviderDescriptor, isAgentProviderId, listAgentProviders } from "./agentProviders";

describe("agentProviders", () => {
  test("registers Esse as the first workbench agent provider", () => {
    const providers = listAgentProviders();

    expect(DEFAULT_AGENT_PROVIDER_ID).toBe("esse");
    expect(providers).toEqual([
      expect.objectContaining({
        id: "esse",
        label: "Esse",
        shortLabel: "Esse",
        status: "available",
        supportsPersona: true,
        workbenchCapabilityIds: [
          "get_project_overview",
          "list_sessions",
          "get_session_records",
          "read_image_metadata",
          "list_reference_images",
          "list_remembered_preferences",
          "scan_unreferenced_files"
        ]
      })
    ]);
  });

  test("validates provider id syntax without coupling the type to Esse", () => {
    expect(isAgentProviderId("esse")).toBe(true);
    expect(isAgentProviderId("codex")).toBe(true);
    expect(isAgentProviderId("claude-code")).toBe(true);
    expect(isAgentProviderId("Codex")).toBe(false);
    expect(isAgentProviderId("")).toBe(false);
    expect(isAgentProviderId(undefined)).toBe(false);
  });

  test("returns cloned provider descriptors by id", () => {
    const descriptor = getAgentProviderDescriptor("esse");
    expect(descriptor?.label).toBe("Esse");

    if (descriptor) {
      descriptor.label = "Changed";
      descriptor.workbenchCapabilityIds.push("mutated");
    }

    expect(getAgentProviderDescriptor("esse")?.label).toBe("Esse");
    expect(getAgentProviderDescriptor("esse")?.workbenchCapabilityIds).not.toContain("mutated");
  });
});
