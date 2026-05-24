import type { TuziLlmApiConfig } from "./localConfig";

export interface CodingAgentSdk {
  AuthStorage?: {
    create: (...args: unknown[]) => unknown;
    inMemory?: () => unknown;
  };
  ModelRegistry?: {
    create: (authStorage: unknown, modelsJsonPath?: string) => CodingAgentModelRegistry;
    inMemory?: (authStorage: unknown) => CodingAgentModelRegistry;
  };
  createAgentSession: (options?: Record<string, unknown>) => Promise<{
    session: CodingAgentSession;
  }>;
}

export interface CodingAgentModelRegistry {
  find: (provider: string, modelId: string) => unknown;
  registerProvider: (providerName: string, config: Record<string, unknown>) => void;
}

export interface CodingAgentSession {
  dispose?: () => void;
  agent?: {
    state?: {
      messages?: unknown[];
    };
  };
  getLastAssistantText?: () => string | undefined;
  messages?: unknown[];
  abort?: () => Promise<void>;
  prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
}

export interface AgentSessionDescriptor {
  builtInTools: string[];
  customTools: string[];
  model: string;
  projectDirectory: string;
  sessionId: string;
}

interface BuildAgentSessionDescriptorOptions {
  customToolNames?: string[];
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
  abort: () => Promise<void>;
  prompt: (text: string) => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
}

type AgentSdkLoader = () => Promise<unknown>;

// pi SDK 的内置文件工具会在 SDK 进程内直接执行，无法被本仓的策略层拦截。
// 默认只暴露只读能力，确保 LLM 即使忽略系统提示也无法改写工程文件；
// 真正需要写入/删除的动作走 run_project_command（受 agentCommandPolicy 限制）。
const DEFAULT_BUILT_IN_TOOLS = ["read", "grep", "find", "ls"];

interface ModelRegistration {
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  thinkingLevel?: "low" | "medium" | "high";
}

const DEFAULT_MODEL_REGISTRATION: ModelRegistration = {
  contextWindow: 200_000,
  maxTokens: 16_384,
  reasoning: true,
  thinkingLevel: "medium"
};

// 按 model id 前缀匹配；最早匹配优先。当前所有支持的模型走默认 registration，
// 等到具体模型需要不同参数（contextWindow / maxTokens / thinkingLevel）时再加条目。
const MODEL_REGISTRATIONS: Array<{ match: RegExp; registration: ModelRegistration }> = [];

function resolveModelRegistration(modelId: string): ModelRegistration {
  for (const entry of MODEL_REGISTRATIONS) {
    if (entry.match.test(modelId)) {
      return entry.registration;
    }
  }

  return DEFAULT_MODEL_REGISTRATION;
}

let agentSdkLoadPromise: Promise<CodingAgentSdk> | undefined;

export function buildAgentSessionDescriptor(
  options: BuildAgentSessionDescriptorOptions
): AgentSessionDescriptor {
  return {
    builtInTools: [...DEFAULT_BUILT_IN_TOOLS],
    customTools: [...(options.customToolNames ?? [])],
    model: options.model,
    projectDirectory: options.projectDirectory,
    sessionId: options.sessionId
  };
}

function extractCustomToolNames(definitions: unknown[] | undefined): string[] {
  if (!Array.isArray(definitions)) {
    return [];
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!definition || typeof definition !== "object") {
      continue;
    }

    const name = (definition as { name?: unknown }).name;
    if (typeof name !== "string" || !name.trim()) {
      continue;
    }

    const trimmed = name.trim();
    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    names.push(trimmed);
  }

  return names;
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

// 注意：warmup 不论传哪个 loader 都会写入模块级缓存，而 loadCodingAgentSdk 只在默认
// loader 时读缓存。这种不对称是有意为之——测试可以 warm 一个 mock loader，让后续
// 默认调用拿到 mock SDK；生产里只用默认 loader，不会出现 loader 不一致的情况。
// 测试隔离靠 resetAgentRuntimeWarmupForTests。
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
  const customToolNames = extractCustomToolNames(options.customToolDefinitions);
  const descriptor = buildAgentSessionDescriptor({ ...options, customToolNames });
  const sdk = options.sdk ?? (await loadCodingAgentSdk());
  const modelOptions = options.llmConfig ? createTuziAgentModelOptions(options.llmConfig, sdk) : {};
  const { session } = await sdk.createAgentSession({
    cwd: descriptor.projectDirectory,
    customTools: options.customToolDefinitions ?? [],
    noTools: "builtin",
    // tools 白名单与实际注册的 custom 工具同步，避免给 LLM 暴露不存在的工具名。
    tools: [...descriptor.builtInTools, ...descriptor.customTools],
    ...modelOptions
  });

  const subscriptions = new Set<() => void>();
  let disposed = false;

  return {
    descriptor,
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;

      for (const unsubscribe of subscriptions) {
        try {
          unsubscribe();
        } catch {
          // 忽略单个监听器解绑异常，继续清理剩余订阅。
        }
      }

      subscriptions.clear();
      session.dispose?.();
    },
    getLastAssistantText: () => getLastAssistantText(session),
    abort: async () => {
      await session.abort?.();
    },
    prompt: (text) => session.prompt(text),
    subscribe: (listener) => {
      const unsubscribe = session.subscribe(listener);
      subscriptions.add(unsubscribe);
      return () => {
        if (subscriptions.delete(unsubscribe)) {
          unsubscribe();
        }
      };
    }
  };
}

function getLastAssistantText(session: CodingAgentSession): string | undefined {
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
  const baseUrl = buildOpenAiCompatibleBaseUrl(config.baseUrl);
  const registration = resolveModelRegistration(config.model);
  modelRegistry.registerProvider("batchimager-tuzi", {
    api: "openai-completions",
    apiKey: config.apiKey,
    authHeader: true,
    baseUrl,
    models: [
      {
        api: "openai-completions",
        baseUrl,
        compat: {
          maxTokensField: "max_completion_tokens",
          requiresToolResultName: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          supportsStore: false,
          supportsStrictMode: true,
          supportsUsageInStreaming: false
        },
        contextWindow: registration.contextWindow,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0
        },
        id: config.model,
        input: ["text", "image"],
        maxTokens: registration.maxTokens,
        name: config.model,
        reasoning: registration.reasoning
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
    ...(registration.thinkingLevel ? { thinkingLevel: registration.thinkingLevel } : {})
  };
}

function buildOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

async function defaultAgentSdkLoader(): Promise<unknown> {
  // pi 包是 ESM-only；这个项目编译目标是 CommonJS，TS 会把静态 `import()` 改写成 require。
  // 这里用 `new Function` 包一层 dynamic import，绕过编译器改写，保留运行时的真正动态 import。
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
