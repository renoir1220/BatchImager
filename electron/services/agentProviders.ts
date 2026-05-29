import type { AgentProviderDescriptor, AgentProviderId } from "../ipcTypes";
import { listBatchImagerWorkbenchCapabilities } from "./batchImagerWorkbenchCapabilities";

export const DEFAULT_AGENT_PROVIDER_ID: AgentProviderId = "esse";

const AGENT_PROVIDERS: AgentProviderDescriptor[] = [
  {
    description: "BatchImager 当前内置的图片工作台协作 agent。负责理解项目状态、发起生成确认卡、调用工作台能力并整理中文回复。",
    id: "esse",
    label: "Esse",
    shortLabel: "Esse",
    status: "available",
    supportsPersona: true,
    workbenchCapabilityIds: listBatchImagerWorkbenchCapabilities().map((capability) => capability.id)
  }
];

export function listAgentProviders(): AgentProviderDescriptor[] {
  return AGENT_PROVIDERS.map(cloneAgentProviderDescriptor);
}

export function getAgentProviderDescriptor(providerId: AgentProviderId): AgentProviderDescriptor | undefined {
  const provider = AGENT_PROVIDERS.find((candidate) => candidate.id === providerId);
  return provider ? cloneAgentProviderDescriptor(provider) : undefined;
}

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function cloneAgentProviderDescriptor(provider: AgentProviderDescriptor): AgentProviderDescriptor {
  return {
    ...provider,
    workbenchCapabilityIds: [...provider.workbenchCapabilityIds]
  };
}
