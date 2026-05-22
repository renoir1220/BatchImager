import type { TuziLlmApiConfig } from "./localConfig";

export interface PiCodingAgentSdk {
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

export interface PiAgentSessionDescriptor {
  builtInTools: string[];
  customTools: string[];
  model: string;
  projectDirectory: string;
  sessionId: string;
}

interface BuildPiAgentSessionDescriptorOptions {
  model: string;
  projectDirectory: string;
  sessionId: string;
}

export interface CreatePiAgentRuntimeOptions extends BuildPiAgentSessionDescriptorOptions {
  customToolDefinitions?: unknown[];
  llmConfig?: TuziLlmApiConfig;
  sdk?: PiCodingAgentSdk;
}

export interface PiAgentRuntime {
  descriptor: PiAgentSessionDescriptor;
  dispose: () => void;
  getLastAssistantText: () => string | undefined;
  prompt: (text: string) => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
}

type PiSdkLoader = () => Promise<unknown>;

const DEFAULT_BUILT_IN_TOOLS = ["read", "write", "edit", "grep", "find", "ls"];
const DEFAULT_CUSTOM_TOOLS = ["run_project_command", "generate_image", "inspect_image", "batch_generate"];
let piSdkLoadPromise: Promise<PiCodingAgentSdk> | undefined;

export function buildPiAgentSessionDescriptor(
  options: BuildPiAgentSessionDescriptorOptions
): PiAgentSessionDescriptor {
  return {
    builtInTools: [...DEFAULT_BUILT_IN_TOOLS],
    customTools: [...DEFAULT_CUSTOM_TOOLS],
    model: options.model,
    projectDirectory: options.projectDirectory,
    sessionId: options.sessionId
  };
}

export async function loadPiCodingAgentSdk(loader: PiSdkLoader = defaultPiSdkLoader): Promise<PiCodingAgentSdk> {
  if (loader === defaultPiSdkLoader && piSdkLoadPromise) {
    return piSdkLoadPromise;
  }

  const promise = loadPiCodingAgentSdkOnce(loader);

  if (loader === defaultPiSdkLoader) {
    piSdkLoadPromise = clearWarmupOnFailure(promise);
  }

  return promise;
}

export async function warmupPiAgentRuntime(loader: PiSdkLoader = defaultPiSdkLoader): Promise<void> {
  if (!piSdkLoadPromise) {
    piSdkLoadPromise = clearWarmupOnFailure(loadPiCodingAgentSdkOnce(loader));
  }

  await piSdkLoadPromise;
}

export function resetPiAgentRuntimeWarmupForTests(): void {
  piSdkLoadPromise = undefined;
}

async function loadPiCodingAgentSdkOnce(loader: PiSdkLoader): Promise<PiCodingAgentSdk> {
  try {
    const sdk = await loader();

    if (isPiCodingAgentSdk(sdk)) {
      return sdk;
    }
  } catch (error) {
    throw new Error(`Pi SDK 加载失败：${getErrorMessage(error)}`);
  }

  throw new Error("Pi SDK 加载失败：未找到 createAgentSession");
}

export async function createPiAgentRuntime(options: CreatePiAgentRuntimeOptions): Promise<PiAgentRuntime> {
  const descriptor = buildPiAgentSessionDescriptor(options);
  const sdk = options.sdk ?? (await loadPiCodingAgentSdk());
  const modelOptions = options.llmConfig ? createTuziPiModelOptions(options.llmConfig, sdk) : {};
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

function createTuziPiModelOptions(config: TuziLlmApiConfig, sdk: PiCodingAgentSdk): Record<string, unknown> {
  const AuthStorage = sdk.AuthStorage;
  const ModelRegistry = sdk.ModelRegistry;

  if (!AuthStorage || !ModelRegistry) {
    throw new Error("Pi SDK 加载失败：缺少 AuthStorage 或 ModelRegistry");
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
    throw new Error(`Pi SDK 模型注册失败：${config.model}`);
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

async function defaultPiSdkLoader(): Promise<unknown> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return dynamicImport("@earendil-works/pi-coding-agent");
}

function isPiCodingAgentSdk(value: unknown): value is PiCodingAgentSdk {
  return typeof value === "object" && value !== null && typeof (value as PiCodingAgentSdk).createAgentSession === "function";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function clearWarmupOnFailure(promise: Promise<PiCodingAgentSdk>): Promise<PiCodingAgentSdk> {
  return promise.catch((error) => {
    piSdkLoadPromise = undefined;
    throw error;
  });
}
