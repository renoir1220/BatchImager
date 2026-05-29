# Esse Agent 多轮 Runtime 复用改造 —— 交接计划

> 本文档自包含：读完后可直接动手，无需任何上下文。

## 0. 目标与范围

把 `electron/services/esseAgent.ts` 改造成跨 IPC 复用 pi runtime 的多轮智能体。模仿 `electron/services/imageSessionAgent.ts` 已落地的模式。

**主要收益**：

- 每轮不再重跑 `createAgentSession` / model registration / typebox load
- SDK 内部累积 messages，省 token（不再把"全部对话历史"作为字符串塞进每轮 user prompt）
- 上下文连续性更稳

**附加机会（可选，推荐做）**：把当前的 "请只返回 JSON" 文本契约换成 pi SDK 的工具调用（tool-as-output），彻底解决 `extractJsonText` 正则提取的脆弱性。详见第 6 节。工作量太大就先做核心复用、JSON 契约保留，留 TODO。

## 1. 基础设施（已就绪，直接复用）

- **`electron/services/agentRuntimeRegistry.ts`** — `AgentRuntimeRegistry`，按 key 缓存 runtime，同 key 串行 + LRU + TTL + 失效语义。直接 `use(...)` 即可，不要新写。
- **`electron/services/agentRuntime.ts`** — `createAgentRuntime(options)`。`customToolDefinitions` 提供则 `tools` 白名单自动同步实际名字。
- **`electron/main.ts`** 的 `project:create` / `project:open` / `before-quit` 已挂 `getSharedAgentRuntimeRegistry().invalidateAll()`，esse 的缓存条目会被一并清理，**不需要再加 hook**。
- **`turnStateByKey: Map<key, TurnState>` 模块级模式** — 见 `imageSessionAgent.ts` 第 70-86 行。把"每轮变化的工具依赖"塞 map，工具 execute 时按 key 读最新值。esse 目前没有 customTools，**只在做了第 6 节的工具化才需要**。

## 2. esse 当前结构（动手前先读一遍）

文件：`electron/services/esseAgent.ts`

两个对外入口：

1. **`runEsseAgentTurn(input, config, projectDirectory, deps)`** — 多轮聊天主路径。IPC：`esse:send-message`（`main.ts:380`）。`input.messages` 是 UI 端可见全部对话历史。
2. **`runEssePlanTurn(input, config, projectDirectory, deps)`** — plan-only 一次性调用。IPC：`project-manager:create-plan`（`main.ts:264`）。**只有一条 user 消息**，无多轮诉求。

当前每次调用都：

- 拼整段 history 进 user prompt（`buildEssePrompt` ≈ L202-275）
- 期待模型返回包含 `reply` + 可选 `plan` / `imageRequests` / `fileTasks` 的 JSON
- `parseEsseResponse` 用 `extractJsonText` 正则兜底
- 用完 `runtime.dispose()`

## 3. 改造方案

### 3.1 缓存 key

```ts
function buildEsseRegistryKey(projectDirectory: string): string {
  return `esse:${path.resolve(projectDirectory).toLowerCase()}`;
}
```

每个项目一个 esse runtime（esse 是 project-level 全局对话，不像 imageSession 一图一会话）。

### 3.2 哪些入口缓存

- **`runEsseAgentTurn`：缓存**。
- **`runEssePlanTurn`：不缓存**。理由：plan-only 是一次性 IPC，无后续轮，复用反而要小心 plan 模型留下的 messages 污染后续 chat。建议在 plan IPC 里**显式 `invalidate(key)`**（防止之前累积的 chat 影响 plan），然后跑完后再 `invalidate` 一次（防止 plan messages 污染下一次 chat）。**或者**：plan 模式直接走 `createAgentRuntime` + dispose，不进 registry。后者更干净，推荐这条。

### 3.3 何时主动 invalidate

在 `runEsseAgentTurn` 入口处：

```ts
const userMessageCount = input.messages.filter((m) => m.role === "user").length;
const registry = deps.registry ?? getSharedAgentRuntimeRegistry();
const key = buildEsseRegistryKey(projectDirectory);
if (userMessageCount <= 1) {
  registry.invalidate(key);
}
```

同时 `runEssePlanTurn` 走完后 `registry.invalidate(key)`（如果选了"plan 也进 registry"那条路）。

### 3.4 prompt 拆分（核心）

把现在的 `buildEssePrompt` 拆成 **`buildFullEssePrompt`** 和 **`buildEsseTurnPrompt`**，模仿 `imageSessionAgent.ts` L264-339 的两层结构。

**`buildFullEssePrompt`（首轮）** — 完全保留当前 `buildEssePrompt` 的内容。包括角色定位、输出契约、路由规则、字段规范、sourceSessionId 规则、人格、本轮上下文、对话历史、输出 JSON 示例。要保证测试断言 `"当前选中图片只是界面焦点，不等于输入图"`、`"用户说"这张图""这个参考图""根据这张图"默认指本轮参考图"` 等仍命中。

**`buildEsseTurnPrompt`（后续轮）** — 只发本轮变化的环境 + 最新 user。建议形如：

```
==== 环境更新 ====
- 当前人格：xxx（如果换了）
- 当前界面焦点图片：img-x / 当前没有界面焦点图片
- 用户本轮选择的输出分辨率：xxx / 用户本轮没有选择输出分辨率
- 可用参考图（覆盖此前）：
  - ref-1: <path>
  ...
- 项目图片（覆盖此前）：
  - img-1: <fileName>，当前图：<path>
  ...
==== 用户本轮要求 ====
<latest user text>
```

注意点：

- **persona 每轮都要重发**（用户可能 UI 上切了人格）。SDK messages 里上一轮的 persona 不再有效。
- **sessions / referenceImagePaths 每轮重发，并明确"覆盖此前"**。
- **不重发**：角色定位、输出契约、路由规则、字段规范、sourceSessionId 规则、JSON 示例。这些已经在首轮 prompt 里，且会随 KV cache 留存。
- **JSON 输出契约**：仍要在 turn prompt 里**简短复述一次**（"按 JSON 对象返回，至少含 reply"），因为 LLM 在很长对话后可能"忘记"格式要求。

### 3.5 主流程改造

参照 `imageSessionAgent.ts` L88-179：

```ts
export async function runEsseAgentTurn(input, config, projectDirectory, deps = {}) {
  const context = "esse-agent";
  const selectedOutputSize = normalizeGenerationSizeValue(input.outputSize);
  // ... logging start, missing-reference guard (保留原逻辑) ...

  const registry = deps.registry ?? getSharedAgentRuntimeRegistry();
  const key = buildEsseRegistryKey(projectDirectory);
  const userMessageCount = input.messages.filter((m) => m.role === "user").length;
  if (userMessageCount <= 1) {
    registry.invalidate(key);
  }

  return await registry.use(
    {
      key,
      factory: async () =>
        await (deps.createRuntime ?? createAgentRuntime)({
          customToolDefinitions: [],
          llmConfig: config,
          model: config.model,
          projectDirectory,
          sessionId: context
        }),
      onCreate: (runtime) => {
        const piLogState = { hasPublishedMessageUpdate: false };
        runtime.subscribe((event) => logAgentEvent(event, deps.logger, piLogState));
      }
    },
    async ({ runtime, isFreshRuntime }) => {
      const promptText = isFreshRuntime
        ? buildFullEssePrompt(input, selectedOutputSize)
        : buildEsseTurnPrompt(input, selectedOutputSize);

      await runtime.prompt(promptText);

      const content = runtime.getLastAssistantText()?.trim();
      if (!content) throw new Error("Esse 未返回有效回复");

      const parsed = parseEsseResponse(content);
      const result = normalizeEsseResponse(parsed, input, selectedOutputSize, {
        acceptPlanOnlyResponse: input.acceptPlanOnlyResponse === true
      });

      deps.logger?.info("Esse agent request completed", { /* ... */ });
      return result;
    }
  );
}
```

注意：**不再 `runtime.dispose()`**，registry 在淘汰 / 失效 / turn 失败时统一处理。

### 3.6 `deps` 加 `registry?` 注入位

```ts
interface EsseAgentDeps {
  createRuntime?: (options: CreateAgentRuntimeOptions) => Promise<AgentRuntime>;
  logger?: AppLogger;
  registry?: AgentRuntimeRegistry;
}
```

测试要给独立 registry 实例避免跨用例污染（看下面 4.1）。

### 3.7 `runEssePlanTurn` 处理

推荐方案：plan-only 模式**不进 shared registry**，用一次性 registry：

```ts
export async function runEssePlanTurn(input, config, projectDirectory, deps = {}) {
  const oneShotRegistry = new AgentRuntimeRegistry();
  try {
    const result = await runEsseAgentTurn(
      {
        messages: [{ content: input.prompt, role: "user" }],
        acceptPlanOnlyResponse: true,
        // ...其它字段
      },
      config,
      projectDirectory,
      { ...deps, registry: oneShotRegistry }
    );
    if (!result.plan) {
      // 现有错误处理
    }
    return result.plan;
  } finally {
    oneShotRegistry.invalidateAll();
  }
}
```

## 4. 测试

### 4.1 测试隔离

`esseAgent.test.ts` 当前测试不传 registry 会用 shared singleton。新加复用测试**必须传独立 registry**：

```ts
import { AgentRuntimeRegistry } from "./agentRuntimeRegistry";
// 每个测试新建：
const registry = new AgentRuntimeRegistry();
// deps 里传 registry
```

**已有测试不动**，让它们继续走 shared singleton（如同 imageSessionAgent.test.ts 现状）。它们用独立 messages 长度 1 触发 invalidate，不会串台。

### 4.2 新增用例

参照 `imageSessionAgent.test.ts` L307-449，至少加：

1. **复用 + 增量 prompt**：连续两次 `runEsseAgentTurn`，第二次 messages 含 2 个 user，期望 `factory` 调一次，`prompts[0]` 含 "输出契约"，`prompts[1]` 含 "环境更新" 且不含 "输出契约"。
2. **首轮重建**：第一次 messages=[user1]，第二次 messages=[user1-new]（用户清空对话）。期望 `factory` 调两次。
3. **persona 跨轮切换**：第一次 persona=`excellent-employee`，第二次 persona=`old-ox`。turn prompt 必须含 `"老黄牛"` 字样（来自 ESSE_PERSONA_INSTRUCTIONS）。
4. **sessions 跨轮变化**：第二次新增一张 session，turn prompt 含该 session id。
5. **plan-only 模式不污染 chat**：先调一次 `runEssePlanTurn`，再调 `runEsseAgentTurn`，期望后者拿到 fresh runtime（factory 为 chat 调一次新的）。

### 4.3 验收

```bash
npm test          # 期望 239 + 新增 → 全绿
npx tsc --noEmit  # 干净
```

## 5. 注意陷阱

### 5.1 `parseEsseResponse` 没动 — 仍依赖文本 JSON

每轮 SDK 内累积的 messages 看起来是：

```
[SDK system, user("完整 system + 历史 + user1"), assistant(JSON1), user("环境更新 + user2"), assistant(JSON2), ...]
```

模型会被引导用同样的 JSON 格式回复每一轮（前面 assistant turn 都是 JSON）。这通常工作良好，但需要在 turn prompt 末尾**简短复述输出契约**。否则模型有几率回纯文本破坏 parse。

### 5.2 `acceptPlanOnlyResponse` 仅 plan-only 用

它从 `runEssePlanTurn` 注入，让 `normalizeEsseResponse` 接受"无 reply 但有 plan"的回复。复用 chat 路径不应该带这个 flag。

### 5.3 persona 切换是个隐性 bug 源

如果首轮 persona=A，模型生成了 A 风格的回复留在 SDK messages 里。第二轮 turn prompt 说 persona=B。模型可能"前几句还在 A 风格，看到 B 后切"。可以接受。但如果用户频繁切换，模型会困惑。建议在 turn prompt 用更强语气："**注意：本轮起人格切换为 xxx，请按新人格回复**"。

### 5.4 referenceImagePaths 跨项目泄露

key 已含 projectDirectory，所以不会跨项目复用。但同项目里参考图集合每轮变化时，**turn prompt 必须明确"覆盖此前"**，否则模型会沿用旧参考图。

### 5.5 测试用 fake AgentRuntime

参照 `imageSessionAgent.test.ts` L323-338 写法：

```ts
{
  descriptor: { builtInTools: [], customTools: [], model: "...", projectDirectory, sessionId: "..." },
  dispose: () => undefined,
  getLastAssistantText: () => '{"reply":"..."}',
  prompt: async (text) => { prompts.push(text); },
  subscribe: () => () => undefined
}
```

## 6. 可选并行：JSON → tool-call

`esseAgent.ts` 第 277 行已有 TODO 注释指向这个方向。理想架构：

- 注册 customTools：`submit_plan`、`submit_image_requests`、`submit_file_tasks`
- 模型通过工具调用提交结构化数据，而非 `reply.plan` 字段
- 最终 reply 直接是模型文本
- 删除 `extractJsonText` / `parseEsseResponse`

**这增加约 50% 工作量**，但根除文本契约脆弱性。如果选做，要同时：

1. 拆 customToolDefinitions，每个 submit_* 工具的 execute 把结构化数据塞 `turnStateByKey` 里收集
2. `normalizeEsseResponse` 改成从 turnState 读取，而不是从 reply 解析
3. prompt 改成"如需提交方案/图请求/文件任务，调相应工具"，不再约束 JSON 输出
4. plan-only 模式：用同样工具但等工具调用完成后取结果

如果觉得范围太大，**只做 1.3 部分，JSON 契约暂留**。TODO 注释保留指向后续。

## 7. 推荐执行顺序

1. 读 `imageSessionAgent.ts` 完整一遍，理解 `turnStateByKey` + `buildFullPrompt` / `buildTurnPrompt` + `invalidate on userMessageCount<=1` 三件套。
2. 读 `agentRuntimeRegistry.ts` 看 `use()` 签名与并发语义。
3. 在 esseAgent.ts 加 `buildFullEssePrompt`（≈ 现 `buildEssePrompt`）+ `buildEsseTurnPrompt`（新）。
4. 改 `runEsseAgentTurn` 主流程接 registry。
5. 改 `runEssePlanTurn` 用一次性 registry。
6. 加测试，跑 `npm test`、`npx tsc --noEmit`。
7. 如果还有余力，做第 6 节的工具化（不强求）。

## 8. 已知遗留（继续保留，不动）

- `referenceAttachmentGuard.ts` 的正则启发式 — UX 决策，不在本次范围。
- `sanitizePiEvent` 的黑名单脱敏 — 见 `imageSessionAgent.ts:399` TODO，需要观察实际泄漏案例再收紧。
- esse 不需要 path validation —— 它不直接处理 imagePath/referenceImagePath，只在 prompt 里展示。`runEsseAgentTurn` 已经不做路径校验，**继续不做**。
