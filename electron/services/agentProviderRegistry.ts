import type {
  AgentProviderDescriptor,
  AgentProviderId,
  SendAgentMessageRequest,
  SendAgentMessageResponse,
  SendEsseMessageRequest,
  SendEsseMessageResponse
} from "../ipcTypes";

export interface WorkbenchAgentProvider<Context> {
  descriptor: AgentProviderDescriptor;
  run: (request: SendEsseMessageRequest, context: Context) => Promise<SendEsseMessageResponse>;
}

export interface AgentProviderRegistry<Context> {
  dispatchMessage: (request: SendAgentMessageRequest, context: Context) => Promise<SendAgentMessageResponse>;
  getProvider: (providerId: AgentProviderId) => WorkbenchAgentProvider<Context> | undefined;
  listProviders: () => AgentProviderDescriptor[];
}

export function createAgentProviderRegistry<Context>(
  providers: WorkbenchAgentProvider<Context>[]
): AgentProviderRegistry<Context> {
  const providersById = new Map<AgentProviderId, WorkbenchAgentProvider<Context>>();

  for (const provider of providers) {
    if (providersById.has(provider.descriptor.id)) {
      throw new Error(`Duplicate agent provider: ${provider.descriptor.id}`);
    }
    providersById.set(provider.descriptor.id, provider);
  }

  return {
    async dispatchMessage(request, context) {
      const provider = providersById.get(request.providerId);
      if (!provider) {
        throw new Error(`Unsupported agent provider: ${request.providerId}`);
      }
      if (provider.descriptor.status !== "available") {
        throw new Error(`Agent provider is not available: ${provider.descriptor.label}`);
      }

      const { providerId: _providerId, ...providerRequest } = request;
      const response = await provider.run(providerRequest, context);

      return {
        ...response,
        providerId: provider.descriptor.id
      };
    },
    getProvider(providerId) {
      return providersById.get(providerId);
    },
    listProviders() {
      return [...providersById.values()].map((provider) => cloneDescriptor(provider.descriptor));
    }
  };
}

function cloneDescriptor(descriptor: AgentProviderDescriptor): AgentProviderDescriptor {
  return {
    ...descriptor,
    workbenchCapabilityIds: [...descriptor.workbenchCapabilityIds]
  };
}
