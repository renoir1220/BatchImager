import type { TuziLlmApiConfig } from "./localConfig";

export interface CodingAgentSdk {
  AuthStorage?: {
    create: (...args: unknown[]) => unknown;
    inMemory?: () => unknown;
  };
  ModelRegistry?: {
    create: (authStorage: unknown, modelsJsonPath?: string) => {
      find: (provider: string, modelId: string) => unknown;
      registerProvider: (providerName: string, config: Record<string, unknown>) => void;
    };
    inMemory?: (authStorage: unknown) => {
      find: (provider: string, modelId: string) => unknown;
      registerProvider: (providerName: string, config: Record<string, unknown>) => void;
    };
  };
  createAgentSession: (options?: Record<string, unknown>) => Promise<{
    session: {
      dispose?: () => void;
      agent?: {
        state?: {
          messages?: unknown[];
        };
      };
      getLastAssistantText?: () => string | undefined;
      messages?: unknown[];
      prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
      subscribe: (listener: (event: unknown) => void) => () => void;
    };
  }>;
}

export interface AgentSessionDescriptor {
  builtInTools: string[];
  customTools: string[];
  model: string;
  projectDirectory: string;
  sessionId: string;
}

interface BuildAgentSessionDescriptorOptions {
  model: string;
  projectDirectory: string;
  sessionId: string;
}

export interface CreateAgentRuntimeOptions extends BuildAgentSessionDescriptorOptions {
  customToolDefinitions?: unknown[];
  llmConfig?: TuziLlmApiConfig;
  sdk?: CodingAgentSdk;
}

export interface AgentRuntime {
  descriptor: AgentSessionDescriptor;
  dispose: () => void;
  getLastAssistantText: () => string | undefined;
  prompt: (text: string) => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
}

type AgentSdkLoader = () => Promise<unknown>;

const DEFAULT_BUILT_IN_TOOLS = ["read", "write", "edit", "grep", "find", "ls"];
const DEFAULT_CUSTOM_TOOLS = ["run_project_command", "generate_image", "inspect_image", "batch_generate"];
let agentSdkLoadPromise: Promise<CodingAgentSdk> | undefined;

export function buildAgentSessionDescriptor(
  options: BuildAgentSessionDescriptorOptions
): AgentSessionDescriptor {
  return {
    builtInTools: [...DEFAULT_BUILT_IN_TOOLS],
    customTools: [...DEFAULT_CUSTOM_TOOLS],
    model: options.model,
    projectDirectory: options.projectDirectory,
    sessionId: options.sessionId
  };
}

export async function loadCodingAgentSdk(loader: AgentSdkLoader = defaultAgentSdkLoader): Promise<CodingAgentSdk> {
  if (loader === defaultAgentSdkLoader && agentSdkLoadPromise) {
    return agentSdkLoadPromise;
  }

  const promise = loadCodingAgentSdkOnce(loader);

  if (loader === defaultAgentSdkLoader) {
    agentSdkLoadPromise = clearWarmupOnFailure(promise);
  }

  return promise;
}

export async function warmupAgentRuntime(loader: AgentSdkLoader = defaultAgentSdkLoader): Promise<void> {
  if (!agentSdkLoadPromise) {
    agentSdkLoadPromise = clearWarmupOnFailure(loadCodingAgentSdkOnce(loader));
  }

  await agentSdkLoadPromise;
}

export function resetAgentRuntimeWarmupForTests(): void {
  agentSdkLoadPromise = undefined;
}

async function loadCodingAgentSdkOnce(loader: AgentSdkLoader): Promise<CodingAgentSdk> {
  try {
    const sdk = await loader();

    if (isCodingAgentSdk(sdk)) {
      return sdk;
    }
  } catch (error) {
    throw new Error(`智能体 SDK 加载失败：${getErrorMessage(error)}`);
  }

  throw new Error("智能体 SDK 加载失败：未找到 createAgentSession");
}

export async function createAgentRuntime(options: CreateAgentRuntimeOptions): Promise<AgentRuntime> {
  const descriptor = buildAgentSessionDescriptor(options);
  const sdk = options.sdk ?? (await loadCodingAgentSdk());
  const modelOptions = options.llmConfig ? createTuziAgentModelOptions(options.llmConfig, sdk) : {};
  const { session } = await sdk.createAgentSession({
    cwd: descriptor.projectDirectory,
    customTools: options.customToolDefinitions ?? [],
    noTools: "builtin",
    tools: [...descriptor.builtInTools, ...descriptor.customTools],
    ...modelOptions
  });

  return {
    descriptor,
    dispose: () => session.dispose?.(),
    getLastAssistantText: () => getLastAssistantText(session),
    prompt: (text) => session.prompt(text),
    subscribe: (listener) => session.subscribe(listener)
  };
}

function getLastAssistantText(session: {
  agent?: { state?: { messages?: unknown[] } };
  getLastAssistantText?: () => string | undefined;
  messages?: unknown[];
}): string | undefined {
  const directText = session.getLastAssistantText?.();

  if (isNonEmptyString(directText)) {
    return directText;
  }

  return extractLastAssistantText(session.messages) ?? extractLastAssistantText(session.agent?.state?.messages);
}

function extractLastAssistantText(messages: unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  for (const message of [...messages].reverse()) {
    if (!isAssistantMessage(message)) {
      continue;
    }

    const text = extractContentText(message.content).trim();

    if (text) {
      return text;
    }
  }

  return undefined;
}

function isAssistantMessage(value: unknown): value is { content: unknown; role: "assistant" } {
  return Boolean(value && typeof value === "object" && "role" in value && value.role === "assistant" && "content" in value);
}

function extractContentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractContentText).join("");
  }

  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }

  return "";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createTuziAgentModelOptions(config: TuziLlmApiConfig, sdk: CodingAgentSdk): Record<string, unknown> {
  const AuthStorage = sdk.AuthStorage;
  const ModelRegistry = sdk.ModelRegistry;

  if (!AuthStorage || !ModelRegistry) {
    throw new Error("智能体 SDK 加载失败：缺少 AuthStorage 或 ModelRegistry");
  }

  const authStorage = AuthStorage.inMemory?.() ?? AuthStorage.create();
  const modelRegistry = ModelRegistry.inMemory?.(authStorage) ?? ModelRegistry.create(authStorage);
  modelRegistry.registerProvider("batchimager-tuzi", {
    api: "openai-completions",
    apiKey: config.apiKey,
    authHeader: true,
    baseUrl: buildOpenAiCompatibleBaseUrl(config.baseUrl),
    models: [
      {
        api: "openai-completions",
        baseUrl: buildOpenAiCompatibleBaseUrl(config.baseUrl),
        compat: {
          maxTokensField: "max_completion_tokens",
          requiresToolResultName: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          supportsStore: false,
          supportsStrictMode: true,
          supportsUsageInStreaming: false
        },
        contextWindow: 200_000,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0
        },
        id: config.model,
        input: ["text", "image"],
        maxTokens: 16_384,
        name: config.model,
        reasoning: true
      }
    ]
  });

  const model = modelRegistry.find("batchimager-tuzi", config.model);
  if (!model) {
    throw new Error(`智能体 SDK 模型注册失败：${config.model}`);
  }

  return {
    authStorage,
    model,
    modelRegistry,
    thinkingLevel: "medium"
  };
}

function buildOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

async function defaultAgentSdkLoader(): Promise<unknown> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return dynamicImport("@earendil-works/pi-coding-agent");
}

function isCodingAgentSdk(value: unknown): value is CodingAgentSdk {
  return typeof value === "object" && value !== null && typeof (value as CodingAgentSdk).createAgentSession === "function";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function clearWarmupOnFailure(promise: Promise<CodingAgentSdk>): Promise<CodingAgentSdk> {
  return promise.catch((error) => {
    agentSdkLoadPromise = undefined;
    throw error;
  });
}
