# Esse Agent v1.1 Plan

## 背景

v1.0 把 Esse 重构成 customTool-only 的 agent、把 main 立为状态权威、preflight 与 broker 解耦——核心抽象都落地了，离线 eval 48 用例 + 真实 LLM 8 场景跑通。但代码评审发现 4 处真 bug、2 处 plan 与代码对不上、4 处关注点、4 条测试缺口；同时 v1 故意推迟的能力（broker ask 模式、undo、参考图工具、preflight modify）需要在 v1.1 补齐，才能让 Esse 从"功能完整"走向"日常可用"。

v1.1 两条主线：

- **Part 1**：v1.0 遗留清理。所有真 bug 必修，plan 对齐项必补，关注点按优先级处理。
- **Part 2**：新增能力。broker 收紧、undo 工具、参考图管理、preflight v2 modify、工作区扩展。

不做向下兼容妥协。v1.0 的接口（`EsseWorkspaceToolRuntime` / `ProjectMutationSink` / `EssePreflightBroker`）形状稳定，v1.1 在其上加字段、加方法，不破坏现有调用方。

### 评审修订基线

v1.1 实施前先按代码现状修正以下计划假设，避免后续 PR 在错误抽象上扩展：

- **per-turn budget 不能绑定到首次创建的 tool closure**。Esse runtime 会跨 turn 复用，`customToolDefinitions` 只在 fresh runtime 时注册一次；预算必须放进可重置的 per-turn state，进入每轮 `runtime.prompt` 前 reset，工具 execute 时读取当前 turn state。
- **`ProjectMutationSink.apply` 的 mutator 保持同步纯函数**。所有文件 IO、blank seed 创建、API 调用、zip 写入都必须在 sink 事务外准备或在专门 executor 中做；sink 内只提交已经准备好的状态变化。
- **batch retry 需要持久化原命令**。`batchTaskRegistry` 只能保存运行期 AbortController，不能作为失败重试的数据来源；失败项重试所需 command 必须写入 batch-task card 或项目状态，否则全部完成后 registry 清理、应用重启后都会丢。
- **项目级参考图不是现有 `ProjectSnapshot` 字段**。参考图工具必须先补项目级 `referenceImages` schema / 持久化 / IPC 快照字段，再注册 list/add/remove 工具。
- **`canceled` 是新 session 状态**。若 batch UI 要显示 canceled，需要扩 `PersistedImageSessionStatus`、DB round-trip、UI 样式和恢复逻辑；不要只在卡片组件里临时使用字符串。
- **共享 generate_image 应抽共享 core，不强行统一 tool adapter**。右侧图片会话工具与 Esse workspace 工具的 schema、prompt metadata、signal 与 preflight 语义不同；共享参数规范化、size/reference 校验、executor 调用即可。

---

## Part 1 — v1.0 遗留处理

### 1.1 真 bug 修复（必做）

#### Bug A: persona prompt 残留 imageRequests/plan

**位置**：[electron/services/esseAgent.ts:54](electron/services/esseAgent.ts#L54)（old-ox）、[:61](electron/services/esseAgent.ts#L61)（question-girl）。

**问题**：两条 persona instruction 仍写"组织 plan/imageRequests"。在 workspaceToolsEnabled=true 时（生产路径），`buildFullEsseWorkspacePrompt` 仍注入完整 personaInstructions，模型同时收到"用工具"和"用 imageRequests/plan"两条相反指令，是"工具能完成的动作偶发只口头答应"的部分根因。

**修法**：

```ts
// old-ox L54 改为：
"回复要短，确认要少；用户要求生成/删除/修改时直接调相应工具，不要在 reply 里假装已经完成。",

// question-girl L61 改为：
"当用户需求已经足够明确时，不要为了人格而硬追问；直接调相应工具，只在 reply 里顺手点出一个可能影响效果的关键选择。",
```

**测试**：在 `esseAgent.test.ts` 加用例：渲染 old-ox / question-girl 的 workspace prompt，断言不出现 `imageRequests` 或 `plan` 字符串。

---

#### Bug B: applyMutation 把 mutator 跑两次

**位置**：[electron/services/esseWorkspaceRuntime.ts:59-83](electron/services/esseWorkspaceRuntime.ts#L59)。

**问题**：当前实现先用闭包 `currentSnapshot` 跑 preview，preview 失败直接返回；preview 成功后再进 `sink.apply` 跑第二次。并发场景下 preview 用 stale state 可能返回虚假 `ok=false`，把真正能跑通的 mutation 截断。

**修法**：去掉 preview，单次走 sink。

```ts
async applyMutation(mutator) {
  try {
    let committedResult: WorkspaceMutationResult | undefined;
    const committedState = await options.sink.apply((state) => {
      const mutation = mutator(state);
      if (!mutation.result.ok) {
        throw new WorkspaceMutationRejected(mutation.result);
      }
      committedResult = mutation.result;
      return mutation.state;
    });

    currentSnapshot = committedState;
    return { result: committedResult!, state: currentSnapshot };
  } catch (error) {
    if (error instanceof WorkspaceMutationRejected) {
      return { result: error.result, state: currentSnapshot };
    }
    throw error;
  }
}
```

**测试**：在 `esseWorkspaceRuntime.test.ts` 加并发用例：构造 mutator 在第一次调用时返回 ok=false，第二次返回 ok=true；并发触发两个 applyMutation，断言两次都得到正确结果（不会被 preview 截断）。

---

#### Bug C: applyProjectSnapshotMutation 不是真事务

**位置**：[electron/services/projectStore.ts:185-202](electron/services/projectStore.ts#L185)。

**问题**：`readProjectSnapshot` 在 tx 外，`mutator` 在 tx 外算，只有 `writeProjectSnapshotInTransaction` 是 tx。单进程 + 单 sink 串行下没 race，但任何旁路（renderer 的 `project:save-snapshot` IPC 仍传整组 sessions 走 sink，未来新入口）都会引入 lost update。

**修法**：把 read + mutate + write 整段包进 `begin immediate transaction`：

```ts
export async function applyProjectSnapshotMutation(
  projectDirectory: string,
  mutator: ProjectSnapshotMutator,
  makeNow: () => Date = () => new Date()
): Promise<ProjectSnapshot> {
  await createProjectDirectories(projectDirectory);
  const db = openProjectDatabase(projectDirectory);
  try {
    initializeSchema(db);
    db.exec("begin immediate transaction");
    try {
      const currentSnapshot = readProjectSnapshot(db, projectDirectory);
      const nextInput = mutator(currentSnapshot);
      writeProjectSnapshotRowsWithinTransaction(db, nextInput, makeNow);
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
    return readProjectSnapshot(db, projectDirectory);
  } finally {
    db.close();
  }
}
```

需要把 `writeProjectSnapshotInTransaction` 拆成两个：(1) 现有的 `writeProjectSnapshotInTransaction` 保留供 `saveProjectSnapshot` 用（自己开 tx）；(2) 新建 `writeProjectSnapshotRowsWithinTransaction` 只做 row 写入，不开/不关 tx。

**测试**：mock `mutator` 在执行时 throw，断言 DB 状态完全没变；并发跑两个 applyProjectSnapshotMutation 在串行下结果与同序 sink.apply 等价。

---

#### Bug D: shouldUseWorkspaceToolsForEsseRequest 死代码

**位置**：[electron/services/esseWorkspaceRuntime.ts:239](electron/services/esseWorkspaceRuntime.ts#L239) + [esseWorkspaceRuntime.test.ts:617](electron/services/esseWorkspaceRuntime.test.ts#L617)。

**问题**：函数已经无生产 caller，但还导出且有测试，假装贡献覆盖率。

**修法**：删函数 + 删 import + 删测试用例 + 删 `projectManagerUi.test.ts:94` 中的字符串断言（如果存在）。

---

### 1.2 Plan 与代码对齐

#### A: Turn 边界完全没实现

**问题**：v1.0 plan 第 387-393 行写了"每 turn 最多 30 次工具调用、写工具 10 次、执行超时 5 分钟、批量按 estimatedApiCalls × 90s"，代码里只有 preflight broker 的 10 分钟。其他全部缺。

**修法**：在 `EsseWorkspaceToolRuntime` 加一层 `turnBudget`，所有工具 execute 入口先 check budget：

```ts
interface EsseTurnBudget {
  toolCalls: { limit: 30; used: number };
  writeCalls: { limit: 10; used: number }; // safe-write + destructive 计入；read 不计；preflight 工具不计
  deadline: number; // Date.now() + 5min
}

// 在 instrumentWorkspaceTool 外层包一层 budget check：
function withTurnBudget(tool: BatchImagerAgentTool, budget: EsseTurnBudget): BatchImagerAgentTool {
  return {
    ...tool,
    async execute(toolCallId, params) {
      if (budget.toolCalls.used >= budget.toolCalls.limit) {
        return toolError(
          "Tool call limit reached for this turn",
          undefined,
          "Summarize what you have done and return a final reply."
        );
      }
      if (Date.now() > budget.deadline) {
        return toolError("Turn execution timed out", undefined, "Return a final reply explaining the timeout.");
      }
      const isWriteTool = tool.risk === "safe-write" || tool.risk === "destructive" || tool.risk === "external-write";
      const isPreflightTool = tool.requiresPreflight;
      if (isWriteTool && !isPreflightTool && budget.writeCalls.used >= budget.writeCalls.limit) {
        return toolError("Write tool call limit reached", undefined, "Summarize and return a final reply.");
      }

      budget.toolCalls.used += 1;
      if (isWriteTool && !isPreflightTool) {
        budget.writeCalls.used += 1;
      }

      return await tool.execute(toolCallId, params);
    }
  };
}
```

预算生命周期：在 `runEsseAgentTurn` 每轮 prompt 前创建/重置 `EsseTurnState`，挂到 workspace runtime（例如 `runtime.beginTurnBudget(...)` / `runtime.getTurnBudget()`）。工具对象可能来自缓存的 agent runtime，不能把 budget 只闭包进首次创建的 tool。补测试：同一个 `AgentRuntimeRegistry` 连续两轮复用 runtime，第二轮 tool call 计数必须从 0 开始。

**run_batch_generation 总超时**：preflight 确认后开始计时，按 `max(5 分钟, estimatedApiCalls * 90 秒)`。在 `executePreflightImageTool` 内用 `AbortSignal.timeout` race 包一层。

**测试**：

- 模拟模型连续调 31 次 read 工具，第 31 次必须返回 isError。
- 模拟模型连续调 11 次 write 工具（非 preflight），第 11 次必须返回 isError。
- 模拟 turn 开始后 push fake clock 超过 5 分钟，下次工具调用必须返回 timeout isError。
- 模拟 run_batch_generation 4 commands × 91 秒（fake executor sleep），必须命中 batch 超时（4 × 90 = 360s）。

---

#### B: generate_image 没共享执行体

**问题**：v1.0 plan 第 71、179 行写"共享执行体"，实际 [imageSessionAgent.ts:153](electron/services/imageSessionAgent.ts#L153) 有 local `createGenerateImageTool`，[esseWorkspaceTools.ts](electron/services/esseWorkspaceTools.ts) 也有独立 `createGenerateImageTool`。两套独立实现，共享的只是更底层的 `tuziImageApi`。

**修法**：抽取共享执行 core 到新文件 `electron/services/sharedGenerateImageCore.ts`，不要强行把两个 agent 的 tool adapter 合成同一种对象：

```ts
interface SharedGenerateImageCoreOptions {
  executor: ImageGenerationExecutor;
  imagePath: string;
  mode: "edit" | "generate";
  prompt: string;
  referenceImagePaths?: string[];
  selectedOutputSize?: string;
  toolRequestedSize?: string;
  sessionId: string;
  signal?: AbortSignal;
}

export async function runSharedGenerateImageCore(options: SharedGenerateImageCoreOptions): Promise<GenerateImageResponse>;
```

右侧 `imageSessionAgent` 保留 Typebox schema、`promptSnippet/promptGuidelines`、selectedOutputSize 优先级和 signal 处理；Esse workspace 版保留 preflight command/target schema 与 sink 写回。两边共享 size/reference 规范化和最终 executor 调用，避免两个 tool adapter 因 SDK 形状不同互相牵扯。

**测试**：给 shared core 加单测覆盖 size 优先级、reference path 传递、signal abort；现有 imageSessionAgent.test.ts 和 esseWorkspaceTools.test.ts 保留各自 adapter 行为测试。

---

### 1.3 关注点处理

| # | 关注点 | v1.1 行动 |
| --- | --- | --- |
| 7 | ProjectMutationSinkRegistry 二次 getOrCreate options 静默丢弃 | 加 dev assert：第二次 getOrCreate 时如果 options 不是同一引用，throw（仅 NODE_ENV=development）；prod 维持现状不破坏 |
| 8 | writeProjectSnapshot 全量 delete+insert 性能 | v1.1 不优化，加 mutation 延迟监控埋点；v1.2 议题 |
| 9 | EssePreflightBroker.reject 路径未清理 signal listener | 在 `reject` 内补 `options.signal?.removeEventListener("abort", abort)`；与 resolve 路径对称 |
| 10 | renderer 仍持 legacy BatchPlan 执行路径 | 见 1.4 测试缺口；v1.1 加 IPC 边界测试 + 加 telemetry 监控该路径调用频次，v1.2 再下沉 |

---

### 1.4 测试缺口

| # | 缺口 | 测试位置 / 关键断言 |
| --- | --- | --- |
| 11 | sink mutator 并发不双跑 | `esseWorkspaceRuntime.test.ts`：mutator 用 counter 计数，断言每次 applyMutation mutator 只被调一次 |
| 12 | turn 工具调用上限 | `esseAgent.test.ts`：模拟 31 次工具调用断言第 31 次 isError；模拟超时 |
| 13 | broadcast 失败时 DB 一致 | `projectMutationSink.test.ts`：broadcast throw，断言 transaction 已 commit、turnState 已更新（设计选择：broadcast 失败不回滚 DB，但要记录 telemetry） |
| 14 | 跨入口 sink 串行 | `projectMutationSink.test.ts`：同一 projectDirectory 两个独立调用方并发触发 sink.apply，断言执行顺序与调用顺序一致 |

---

## Part 2 — v1.1 新功能

### 2.1 Broker 收紧（destructive 弹卡片）

#### 目标

把 v1.0 的"默认 allow"切到"destructive / external-write 默认 ask"，让用户对"删除 session、合并、物理删除、打包到桌面"这类操作有事前拦截机会。架构在 v1.0 已经留好（PermissionBroker 接口、IPC 通道占位、chat 消息类型占位），v1.1 实现 UI 和 policy 切换。

#### Policy 配置

新建 `electron/services/essePermissionPolicy.ts`：

```ts
export type EssePermissionPolicy = {
  read: "allow";                   // 永远 allow
  "safe-write": "allow" | "ask";   // 默认 allow，可配置
  destructive: "allow" | "ask";    // v1.1 默认改 ask
  "external-write": "allow" | "ask"; // v1.1 默认改 ask
};

export const DEFAULT_ESSE_PERMISSION_POLICY: EssePermissionPolicy = {
  read: "allow",
  "safe-write": "allow",
  destructive: "ask",
  "external-write": "ask"
};
```

policy 来源：v1.1 先用 hardcoded 常量，留个 `localConfig` 字段供后续覆盖。不做用户面 setting UI（v1.2）。

#### 为什么 generate_image / run_batch_generation 是 safe-write

虽然这些工具会调用 image API、消耗 credit，但用户保护由 preflight 承担：preflight 已经展示完整命令列表、目标图片和 API 调用数。若 broker 再把它们标成 destructive，会形成重复确认。

风险类别的实际设计原则：

- broker 拦截"没有其他用户保护的写操作"
- preflight 已覆盖的工具不再触发 permission 卡片

按这个原则：

- `generate_image` / `run_batch_generation`：有 preflight → `safe-write`，broker 默认 allow
- `package_generated_images`：有 preflight → `safe-write`，broker 默认 allow
- `add_reference_image`：无 preflight → `external-write`，broker 默认 ask
- `delete_session_record` 等数据销毁：无 preflight → `destructive`，broker 默认 ask

#### Broker 实现

新建 `electron/services/essePermissionBroker.ts`，结构对照 `essePreflightBroker.ts`：

```ts
export class EssePermissionBroker {
  request(
    webContents: Pick<WebContents, "send">,
    request: EsseWorkspacePermissionRequest,
    options: { policy: EssePermissionPolicy; signal?: AbortSignal; sessionAllowList: Set<string> }
  ): Promise<EsseWorkspacePermissionDecision>;
  respond(response: EssePermissionResponse): boolean;
}
```

流程：

1. 工具调 `runtime.requestPermission(req)`。
2. broker 查 `policy[req.risk]`：`allow` → 直接 resolve `{decision: "allow"}`；`ask` → 走 IPC。
3. 若 `req.toolName + req.targetKey` 在本 turn 的 `sessionAllowList` 中（用户之前选了"本会话允许"），直接 allow。
4. 否则 `webContents.send("esse:permission-request", {...})` 等用户决定。
5. 用户答 allow once / allow for session / deny；session 选项写入 sessionAllowList。

#### IPC

- main → renderer: `esse:permission-request` { requestId, payload }
- renderer → main: `esse:permission-response` { requestId, decision: "allow-once" | "allow-session" | "deny", reason? }
- 5 分钟超时自动 deny（比 preflight 短，因为风险更高）

`EsseWorkspacePermissionRequest` 在 v1.0 已定义，v1.1 扩 `targetKey` 字段（用于 session 级 allow-list 去重，比如同一 session 反复 delete record 只问一次）：

```ts
interface EsseWorkspacePermissionRequest {
  ...existing fields...
  targetKey: string;  // 比如 `delete_session_record:sess_xxx` 或 `delete_session:sess_xxx`
  affectedDisplayLabel?: string;
  affectedFileName?: string;
}
```

#### UI

`contextType: "esse-permission-request"` 在 v1.0 已留消息类型，v1.1 实现渲染：

- 卡片标题："Esse 请求确认：删除 img-2 的记录 3"
- 受影响 session displayLabel + fileName
- 操作类型中文说明
- 三个按钮：允许一次 / 本次会话允许 / 拒绝
- 决定后定格为结果状态（带决定标识 + 时间）

新增组件 `src/components/EssePermissionCard.tsx`，挂到 ProjectPlanPanel chat message 渲染分支。

#### 测试

- broker：policy=ask 时走 IPC，policy=allow 时立即 resolve。
- broker：sessionAllowList 命中时立即 resolve 不发 IPC。
- broker：deny 后续工具调用收到 isError，模型有 reason 可读。
- broker：5 分钟超时 deny。
- LLM eval：加一条 "删除 img-2" 场景，stub permission broker 返回 allow，验证完整链路；再加一条 stub 返回 deny，验证 Esse reply 反映"用户拒绝了删除请求"。

---

### 2.2 Undo 工具

#### 目标

让用户能撤销最近 N 次写操作。v1 的 toolCallSink 已经把每次工具调用作为 chat context message 落盘，本身就是 undo 日志原料。v1.1 把日志结构化、加 reverse reducer、加 `undo_last_actions` 工具。

#### 数据模型扩展

`EsseWorkspaceToolCallEvent` 增加 reversibility 字段：

```ts
interface EsseWorkspaceToolCallEvent {
  ...existing...
  reversible?: {
    inverseSummary: string;   // "撤销：还原已删除的记录 3"
    inverseMutator: (state: ProjectSnapshot) => { result: WorkspaceMutationResult; state: ProjectSnapshot };
  };
}
```

原计划是每个写工具在调 sink 时同时构造 inverse mutator（基于"删除前的 state - 删除后的 state"差异）。这套 per-tool inverse 设计可行，但 v1.1 实际实现选择了后文的完整 state 快照方案，避免在收尾阶段维护多套逆向 reducer。

- `restore_session_record` → 反向 `restore_session_record(previousRecordIndex)` 或 `restore_original`
- `delete_session_record` → 反向 `appendRecord(removedPath, atIndex)`
- `delete_session` → 反向 `insertSession(removedSession, atPosition)`
- `merge_sessions` → 反向 `splitSession(targetId, originalSources)`（需要保留 source sessions 的完整快照）
- `rename / reorder / set_prompt` → 反向用旧值重写

不可逆：`generate_image`（已经花了 API 钱，逻辑 undo 无意义，物理上文件还在；可用 `delete_session_record` 间接实现）、`package_generated_images`（文件已写到桌面）、`delete_unreferenced_files`（文件已物理删除）。这些工具的 toolCallSink event `reversible` 留空。

#### 持久化

每次工具调用的 inverse 写到 `project_state` 表的新 key `esseUndoLog`，最多保留 50 条（FIFO）。每条记录：

```ts
interface PersistedUndoEntry {
  affectedSessionIds: string[];
  createdAt: string;
  id: string;
  inverseDescriptor: SerializableUndoDescriptor; // 不能存 closure，必须 serializable
  summary: string;
  toolName: string;
}
```

inverse 不能存函数闭包（要持久化）。原计划的 per-tool descriptor 如下；v1.1 实际落地的 `SerializableUndoDescriptor` 仅保留 `restore-workspace` 快照描述符：

```ts
type SerializableUndoDescriptor =
  | { kind: "restore-original"; sessionId: string }
  | { kind: "restore-record"; sessionId: string; recordIndex: number }
  | { kind: "insert-record"; sessionId: string; recordIndex: number; filePath: string }
  | { kind: "insert-session"; session: PersistedImageSession; position: number; selectedAfter: boolean }
  | { kind: "split-session"; sourceSessions: PersistedImageSession[]; targetSessionId: string }
  | { kind: "rename"; sessionId: string; previousFileName: string }
  | { kind: "reorder"; previousOrder: string[] }
  | { kind: "set-prompt"; sessionId: string; previousPrompt: string | undefined };
```

`applyUndoDescriptor(state, descriptor)` 是新的纯函数，把 descriptor 翻译成 state mutation。

#### 实现选择：完整 state 快照而非 per-tool inverse

v1.1 实际实现采用简化方案：每条 undo entry 保存调用前的完整 workspace state（sessions + selectedSessionId + referenceImages + projectImageCount），undo 时直接替换为这个快照。

取舍说明：

- ✅ 实现简单，所有 reducer 自动支持 undo，不用维护多种 per-tool 逆操作
- ⚠️ 存储膨胀：大项目里单条 entry 可能达到数百 KB，50 条上限可能让项目 SQLite 增长到数十 MB
- ⚠️ undo 会回退中间发生的其他工作区写入（手动 UI 操作、非可逆 Esse 写入等）

防御：ProjectMutationSink 维护 revision。Undo entry 记录写入后的 `sinkRevisionAfter`；undo 时如果检测到目标 undo entry 与当前 revision 之间存在额外工作区写入，会在工具结果里透传 `⚠️` 警告，让模型和用户知道这次撤销可能影响中间操作。该警告不阻断 undo。

如果未来生产观察到存储或语义问题，再考虑改成 per-tool inverse 或 diff-only 方案。

#### Undo 工具

```ts
{
  name: "undo_last_actions",
  label: "撤销最近操作",
  risk: "destructive",            // 撤销本身也是破坏性，需要权限
  requiresPreflight: false,
  description:
    "Undo the most recent N reversible workspace actions in this project. " +
    "Use when the user asks to undo, revert, take back, or restore the previous state. " +
    "Not all actions are reversible: image generation, packaging, and physical file deletion cannot be undone. " +
    "Parameters: count — number of recent actions to undo (default 1, max 10). " +
    "Returns the list of undone action summaries and the count of skipped non-reversible actions encountered.",
  parameters: objectParameters({ count: "Optional 1..10, default 1." }, []),
  execute(...) { /* read undo log → apply inverse descriptors in reverse → mark undone entries → return summary */ }
}
```

undo 后日志条目被标记为 undone，不再可重复 undo（不做 redo，v1.2 议题）。

#### UI

undo 触发的 mutation 也走 mutationSink → 也广播 snapshot → renderer 自动 reconcile。chat 里出现 `esse-tool-call` context message "Esse 工具调用：撤销最近操作（完成）结果：已撤销 1 个操作：删除 img-2 记录 3"。

#### 测试

- 每个可逆写工具：写一次 → undo → 状态完全相等（深度比较 ProjectSnapshot）。
- 不可逆工具（generate_image 等）：toolCallSink event 的 reversible 字段不写入；undo 工具看到这种条目跳过。
- 连续 5 个写操作 → undo count=5 → 全部撤销正确。
- undo 日志超 50 条 → 最旧的被 FIFO 清除。
- 持久化 round-trip：写日志 → 关项目 → 重开 → undo 仍能恢复。

---

### 2.3 参考图管理工具

#### 目标

v1 模型只能通过 `referenceImageIds` 引用已存在的参考图，不能添加或管理。v1.1 补齐三个工具。

#### 工具

```ts
{
  name: "list_reference_images",
  label: "列出参考图",
  risk: "read",
  requiresPreflight: false,
  description:
    "List all reference images attached to the current project. " +
    "Returns id, fileName, byteSize for each. Use before referencing images in generate_image / run_batch_generation."
}

{
  name: "add_reference_image",
  label: "添加参考图",
  risk: "external-write",       // 写入项目 references/ 目录
  requiresPreflight: false,     // 不调 API，不打断
  description:
    "Add a reference image to the current project from a local file path the user shared in this turn. " +
    "Use only when the user explicitly attached or pasted a new image and asks to register it as a reference. " +
    "Do NOT invent file paths or download from URLs. " +
    "Parameters: filePath — must be from the current turn's referenceImagePaths input; fileName? — optional display name."
}

{
  name: "remove_reference_image",
  label: "删除参考图",
  risk: "destructive",
  requiresPreflight: false,     // broker 会拦
  description:
    "Remove one reference image from the project by id. Does not delete the original source file. " +
    "Parameters: referenceImageId — stable id from list_reference_images."
}
```

`add_reference_image` 入参约束：`filePath` 必须在本 turn 的 `referenceImagePaths` 列表中，否则 isError。这阻止模型自己编路径。

#### 项目级 schema

当前 `ProjectSnapshot` 没有顶层 `referenceImages` 字段，v1.1 先补项目级参考图持久化：

```ts
interface ProjectSnapshot {
  ...existing...
  referenceImages?: BatchPlanReferenceImage[];
}
```

SQLite 可先复用 `project_state.referenceImages` JSON（字段少、更新频率低），后续如果参考图元数据增加再拆表。`readProjectSnapshot` / `saveProjectSnapshot` / `applyProjectSnapshotMutation` / `SaveProjectSnapshotRequest` 都要 round-trip 该字段；renderer 保存 snapshot 时必须透传，避免旧 save 覆盖参考图列表。

#### 实现

reducer 在 `projectMutations.ts`：

```ts
applyAddReferenceImage(state, params): { state, result }
applyRemoveReferenceImage(state, params): { state, result }
```

物理 add 走 main 进程的现有 `saveReferenceImageToDirectory`；remove 物理删除走 `unlink`。两者走 sink.apply 同步更新 snapshot.referenceImages。

ProjectSnapshot schema 改动完成后，`list_reference_images` 从顶层 `snapshot.referenceImages` 读取；已有旧 `BatchPlan.referenceImages` 仅作为历史计划上下文，不再作为项目参考图真源。

#### 测试

- `add_reference_image` 拒绝 turn-外路径。
- `add_reference_image` 拒绝非图片扩展名。
- `add_reference_image` 后 referenceImages 数组增加一条，文件落盘。
- `remove_reference_image` 后 sink.apply 移除条目，物理文件删除。
- LLM eval：用户说"把这张图加为参考图"（附带 paste），验证 Esse 调 list_reference_images → add_reference_image。

---

### 2.4 Preflight v2: Modify

#### 目标

v1 preflight 只有 execute / cancel；cancel 后模型若原样重试会再次走 preflight，token 浪费。v1.1 加 modify 决策：用户可在卡片上编辑 prompt / 调整 mode / 改 referenceImageIds 后点"修改后执行"，工具直接用修改后的 commands 执行，不走第二轮模型推理。

#### IPC 扩展

```ts
type EssePreflightDecision =
  | { decision: "execute" }
  | { decision: "modify"; modifiedCommands: EssePreflightCommand[] }
  | { decision: "cancel"; detail?: string };
```

`esse:preflight-response` 协议同步扩。modify 必须返回与原 payload commands 数量相同、目标相同的 commands（不允许新增/删除 command，避免模型 plan 与实际执行偏离过多）。

#### UI

`EssePreflightCard` 增加"修改"按钮 → 切换到编辑模式：

- 每条 command 的 prompt 文本框可编辑
- mode 可在 edit/generate 之间切换（如果原 mode=edit 且 target.type=existing，切到 generate 时 UI 提示"将忽略当前图"）
- referenceImageIds 可勾选
- 编辑完成点"按修改执行"返回 modify decision，原"取消"按钮保留

不允许 modify 的 case：

- `package_generated_images`（commands 只是描述，没有可编辑的 prompt）→ 只显示 execute / cancel

#### 工具侧处理

`executePreflightImageTool` 收到 modify → 用 modifiedCommands 覆盖原 commands → 直接调底层 executor，不再二次询问模型。

#### 测试

- broker：返回 modify decision，工具执行用的是修改后 commands。
- broker：modify 但 commands 长度不匹配 → 视为协议错误，自动 cancel + isError。
- 端到端 stub：模型给出 prompt A → 用户改成 prompt B → 实际 executor 收到 prompt B。

---

### 2.5 批量任务派发与取消（恢复 fire-and-forget 语义）

#### 背景与目标

v1.0 重构把图像生成从"会话派发任务并行执行"变成了"批量工具内部串行 await N 次 API"。后果：模型一次决策 4 张图，用户要等 4×60s 才能看到第一张回来；Esse turn 在这段时间被卡住。

v1.1 恢复重构前的派发语义并升级：preflight 确认 → 立即创建 N 个 session（占位入工作区）→ 后台并行派发任务 → 工具立即返回"已提交"→ 任务完成时各自走同一 mutationSink 写回。Esse turn 在派发完成后立即结束，模型可以做其他事，用户在工作区实时看到任务状态。

同步把"单图 generate_image"也改成 fire-and-forget，与批量统一——因为左侧工作区会立即出现任务卡，用户感知不到"消失"。

#### 关键设计：单图与批量执行层合并

工具层保留两个独立工具（description 不同，让模型路由清晰），但内部都通过统一的 `submitImageGenerationBatch(commands)` 派发：

- `generate_image` 内部 `submitImageGenerationBatch([single command])`，commands.length=1。
- `run_batch_generation` 内部 `submitImageGenerationBatch(commands)`。
- 两者产出同一种 `batch-task` 卡片，commands 数量不同而已。
- 单图/批量在派发、取消、状态写回、错误隔离上完全一致——只维护一套逻辑。

#### submitImageGenerationBatch 流程

```ts
async function submitImageGenerationBatch(
  commands: EssePreflightCommand[],
  context: BatchSubmitContext  // { sink, generateImage, projectDirectory, signal }
): Promise<BatchSubmitResult> {
  // Step 1: 先在事务外准备 target.type=new 需要的 blank seed 文件
  // 注意：ProjectMutationSink.apply 的 mutator 是同步纯函数，不能在里面 await。
  const batchTaskId = createBatchTaskId();
  const preparedNewTargets = await prepareBlankSeeds(commands, projectDirectory);

  // Step 2: 在一次 sink.apply 内创建 session + 标记 queued
  const items: BatchTaskItem[] = [];
  await sink.apply((state) => {
    let next = state;
    for (const command of commands) {
      const sessionId = command.target.type === "existing"
        ? command.target.sessionId
        : preparedNewTargets.get(command)!.sessionId;
      next = applyMarkSessionQueued(next, sessionId, command.instruction);
      items.push({ sessionId, mode: command.mode, promptSummary: command.instruction.slice(0, 120), displayLabel: computeDisplayLabel(next, sessionId) });
    }
    return next;
  });

  // Step 3: 注册 batchTask 到 main 的 batchTaskRegistry
  const abortControllers = new Map<string, AbortController>();
  for (const item of items) abortControllers.set(item.sessionId, new AbortController());
  batchTaskRegistry.register(batchTaskId, { abortControllers, projectDirectory });

  // Step 4: 在 sink 内追加 batch-task chat message（卡片落盘，含 retry 所需 command 快照）
  await sink.apply((state) => appendBatchTaskCardMessage(state, { batchTaskId, items }));

  // Step 5: fire-and-forget 派发每个任务
  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i];
    const item = items[i];
    const controller = abortControllers.get(item.sessionId)!;
    void runSingleGeneration({ command, item, controller, sink, generateImage, batchTaskId });
    // runSingleGeneration 内部：
    //   await sink.apply(markGenerating)
    //   try { result = await generateImage({ ..., signal: controller.signal }) ; await sink.apply(appendResult) }
    //   catch (abort) { await sink.apply(markCanceled) }
    //   catch (error) { await sink.apply(markFailed) }
    //   finally { batchTaskRegistry.notifyItemComplete(batchTaskId, item.sessionId) }
  }

  // Step 6: 立即返回
  return {
    batchTaskId,
    submittedCount: items.length,
    items
  };
}
```

工具 execute 层包装：

```ts
// generate_image / run_batch_generation 的 execute 末尾：
const result = await submitImageGenerationBatch(commands, ctx);
return toolOk(
  `已提交 ${result.submittedCount} 个生成任务。任务在后台并行执行，完成后会自动出现在工作区。可在对话卡片中查看进度或取消。`,
  { batchTaskId: result.batchTaskId, sessionIds: result.items.map((item) => item.sessionId) }
);
```

#### batch-task chat 卡片

新增 chat contextType：

```ts
type ImageSessionContextType = ... | "esse-batch-task";

interface PersistedBatchTaskCardData {
  batchTaskId: string;
  items: Array<{
    command: EssePreflightCommand; // 持久化，失败重试和重启后重试都从这里恢复
    displayLabel: string;       // 创建时快照，仅用于卡片显示稳定
    mode: "edit" | "generate";
    promptSummary: string;
    sessionId: string;          // 稳定 id
  }>;
}
```

卡片渲染（新组件 `src/components/EsseBatchTaskCard.tsx`）：

- 标题：`已提交 N 个生成任务`
- 每个 item 一行：displayLabel + 状态图标（queued/generating/completed/failed/canceled） + mode tag + 截断 prompt
- 状态实时来自 `sessions[sessionId].status`——卡片只渲染快照，不维护独立状态
- 每行右侧按钮：未完成时"取消"，完成时"打开"（点击 selectedSessionId=该 id）
- 卡片底部"全部取消"按钮：仅取消本卡片内 status ∈ {queued, generating} 的 item
- 全部 item 结束后底部按钮消失，卡片定格

`canceled` 需要同步扩展 `PersistedImageSessionStatus`、SQLite round-trip、恢复逻辑和 UI 样式；如果实现时决定不扩状态，则本节所有 canceled 显示改为 `failed + errorMessage="已取消"`，不能两套语义混用。

#### main 进程 batchTaskRegistry

```ts
interface BatchTaskEntry {
  abortControllers: Map<string, AbortController>;
  projectDirectory: string;
  remainingItemIds: Set<string>;
}

class BatchTaskRegistry {
  register(batchTaskId: string, entry: { abortControllers: Map<string, AbortController>; projectDirectory: string }): void;
  cancelItem(batchTaskId: string, sessionId: string): boolean;
  cancelAll(batchTaskId: string): number;
  notifyItemComplete(batchTaskId: string, sessionId: string): void;  // 内部清理，全部 done 后删 entry
}
```

主进程持单例：

```ts
const batchTaskRegistry = new BatchTaskRegistry();
```

#### IPC

```ts
"esse:batch-task-cancel-item": (request: { batchTaskId: string; sessionId: string }) => { canceled: boolean }
"esse:batch-task-cancel-all":  (request: { batchTaskId: string }) => { canceledCount: number }
```

renderer 在卡片按钮 onClick 时调对应 IPC。main 的 handler 调 batchTaskRegistry → AbortController.abort → 派发的 runSingleGeneration 捕获 signal abort 走 markCanceled 路径。

#### Esse 对话框 stop 语义分离

`app:cancel-operation` IPC 只 abort `runEsseAgentTurn` 的 signal（停模型推理），**不动 batchTaskRegistry**。已派发的后台任务继续跑。用户期望"我让 Esse 别废话了，但图该出还得出"。

#### 失败项重试

batch-task 卡片上 `status=failed` 的 item 显示"重试"按钮。点击 → 用原命令重新派发（不走 preflight，因为用户已经确认过一次），覆盖原 session 状态。

原 command 不放在 `batchTaskRegistry` 里作为唯一来源。registry 是运行期结构，全部 item 完成后会清理，应用重启也会丢；重试命令以持久化的 batch-task card data 为准，registry 只在 item 重新开始运行时重新注册 AbortController。

```ts
interface BatchTaskEntry {
  abortControllers: Map<string, AbortController>;
  projectDirectory: string;
  remainingItemIds: Set<string>;
  retryCounts: Map<string, number>;                      // sessionId → 已重试次数
}
```

新增 IPC：

```ts
"esse:batch-task-retry-item": (request: { batchTaskId: string; sessionId: string }) => {
  accepted: boolean;
  reason?: string;
}
```

main handler 流程：

1. 从项目快照里的 batch-task card data 读取原 command；校验 batchTaskId/sessionId 存在、session 当前 status="failed"。
2. 校验 retryCounts.get(sessionId) < 3（最多 3 次重试，防止 API 钱袋子失控）。
3. 通过 sink.apply 把 session.status 改回 "queued" + 清空 errorMessage。
4. 新建 AbortController 替换原 entry.abortControllers 内的条目。
5. retryCounts +1。
6. 调用 runSingleGeneration（与首次派发同一函数），用持久化 card data 中的 command。

卡片 UI：

- 重试按钮在 status=failed 时出现；点击后立即变成 status=generating 的进度条（卡片实时反映 session 状态）
- 重试 3 次后仍失败 → 重试按钮变灰，tooltip "已重试 3 次，请删除该会话或新建任务"
- 卡片底部增加"重试所有失败项"按钮（仅在有 status=failed item 时显示）

#### 测试

补充测试（与基础 batch 派发测试合并到同一 PR）：

- 第 1 次失败 → 卡片显示重试按钮 → 点击 → 重新派发，sink 收到一次 markGenerating + 一次 markCompleted（mock 这次返回成功）
- 重试 3 次仍失败 → IPC 返回 accepted=false reason="retry limit reached"
- 非 failed 状态点重试 → IPC 返回 accepted=false reason="session is not in failed state"
- 重试时 batchTaskRegistry entry 已被清理（其他所有 item 都完成且自己在重试中） → 仍能找到 entry，重试后再次走 notifyItemComplete 触发清理
- "重试所有失败项"按钮触发 N 个并行重试，互不影响

#### 全新生成 session 的图片身份修复

**当前 bug**：`esseImagePreflightExecutor.ts` 为 `target.type="new"` 的 command 调 `createBlankGenerationSeed` 写一张空白 PNG，`session.filePath` 永远指向这张 blank seed；生成完成后只追加 `generatedFilePath` / `generatedFilePaths`，filePath 不动。结果：

- `session.filePath` 永远是空白占位（不是用户想看到的"第一张图"）
- `restore_original` 把当前图切到 filePath 时显示空白
- list_sessions 返回 currentImageSource="原图" 时 sourceType 语义错位
- 全新生成 session 被错误地建模成"导入空白原图 + 跑了一次 edit"

**语义修复**：全新生成 session 没有"原图"概念，第一次生成出来的图就是这个 session 的"主图"。

在 `submitImageGenerationBatch` 的 `runSingleGeneration` 实现里：

```ts
async function runSingleGeneration(...): Promise<void> {
  await sink.apply(markGenerating);
  try {
    const result = await generateImage({ ..., signal });
    await sink.apply((state) => finalizeNewSessionPrimary(state, {
      sessionId: item.sessionId,
      outputPath: result.outputPath,
      originatedFromGeneration: command.target.type === "new"
    }));
    if (command.target.type === "new") {
      await unlinkBlankSeedSafely(originalBlankSeedPath);
    }
  } catch (...) { ... }
}
```

`finalizeNewSessionPrimary` reducer 对 originatedFromGeneration=true 的 session：

- `session.filePath = outputPath`（替换 blank seed 路径）
- `session.generatedFilePath = outputPath`
- `session.generatedFilePaths = [outputPath]`（同时进记录列表，让 get_session_records 看到 1 条）
- `session.showOriginalInList = false`
- `session.status = "completed"`

PersistedImageSession 新增持久化字段：

```ts
interface PersistedImageSession {
  ...existing...
  originatedFromGeneration?: boolean;  // 仅全新生成 session 为 true；导入图为 undefined/false
}
```

#### 修复后的工具语义对齐

`restore_original` 对 `originatedFromGeneration=true` 的 session：

- 第一次生成图 = filePath = generatedFilePaths[0]
- restore_original 行为：把当前图切回 generatedFilePaths[0]（等价于第一张生成图）；如果当前图已经是第一张，no-op
- 不再返回 isError "no original to restore"，避免模型困惑——语义平滑退化成"回到第一张生成图"

`delete_session_record` 对 `originatedFromGeneration=true` session 的"记录 1"（即第一张生成图）的删除：

- 第一张图同时是 filePath 和 generatedFilePaths[0]
- 删除时：从 generatedFilePaths 移除；如果是当前图，fallback 走现有逻辑
- 但 filePath 仍指向那个物理文件——文件不能立即物理删除（其他 chat message 可能引用）
- session 的"主图"语义变成"原 filePath 已删除"：UI 显示空白？还是显示 generatedFilePaths 中下一张作为新主图？
- **决策**：delete_session_record 删除 originatedFromGeneration session 的最后一张记录时，转化为 delete_session（整个 session 移除）；删除中间记录时正常处理，filePath 不动（仍是历史第一张的物理路径，但 generatedFilePath 切到 fallback，UI 看不到 filePath）

`list_sessions` 返回 currentImageSource：

- 对 originatedFromGeneration=true session，永远返回 "生成图"，不返回 "原图"
- 模型在 prompt 中看到的就是"这是全新生成的图，没有原图"

`get_session_records` 对 originatedFromGeneration=true session 返回的 record 1 显示 `isPrimary: true`，让模型理解这是"主图"而非普通历史记录。

#### Blank seed 的处理

派发时 blank seed 仍然需要写到 disk（status=generating 时 UI 显示占位缩略图），但：

- blank seed 路径只在 turn 内有效，存到 batchTaskRegistry 的 entry 里
- runSingleGeneration 成功完成 → unlink blank seed
- runSingleGeneration 失败/取消 → 保留 blank seed（让 session UI 仍能显示占位）；用户后续 delete_session 时一并清理
- 崩溃恢复 sweeper 把僵尸 generating 改 failed 时同样保留 blank seed

#### 迁移现有数据

老项目里可能已经存在"filePath 指向 blank seed 路径"的 session（v1.0 重构后到 v1.1 之间创建的）。migration 不主动改写——风险高且影响面不清。改成在 `originatedFromGeneration` 字段缺失时按以下启发式补：

- 如果 session.filePath 指向 `<generated dir>/<sessionId>-seed.png` 这种 blank seed 命名模式，标记 originatedFromGeneration=true
- 否则视为导入图（originatedFromGeneration=false/undefined）

启发式在第一次打开项目时一次性补全 originatedFromGeneration 字段，写回 SQLite。对补成 true 且仍有 blank seed 的 session，再做一步"是否能把 filePath 替换成 generatedFilePaths[0]"判断：如果 generatedFilePaths 非空且第一项文件存在，替换并 unlink blank seed；否则保留现状。

#### 测试

- 全新生成 → filePath = 生成图，generatedFilePaths = [生成图]，no blank seed on disk after completion
- 全新生成失败 → filePath 仍是 blank seed，status=failed，UI 显示失败占位
- 全新生成后再 mode=generate → 新图追加到 generatedFilePaths，filePath 不动
- 全新生成后再 mode=edit → 新图追加，generatedFilePath 切到新图，filePath 不动
- restore_original 在 originatedFromGeneration session 上切回 filePath（第一张生成图），不显示空白
- delete_session_record 删唯一记录时转化为 delete_session
- 旧项目 migration：blank seed 命名匹配的 session 被标记，如果有 generated 历史则替换 filePath
- LLM eval："生成 1 张鲜花图" → 完成后用户问"看一下这张图的尺寸" → 模型调 read_image_metadata → 返回的是真实生成图尺寸不是空白占位

#### 与现有 generation job 系统的关系

main.ts 中已有 `startGenerationJob` / `markGenerationJobCompleted` / `markGenerationJobFailed` / `recoverInterruptedGenerationJobs` 这套机制（崩溃恢复用）。新的 batch 派发应该复用：

- runSingleGeneration 内部继续调 startGenerationJob 写崩溃日志
- markCompleted/Failed 同时调 markGenerationJob* 维持崩溃恢复语义
- 这样 app 中途崩溃重启时仍能恢复未完成的 generation；batch 卡片下次打开项目时根据 session.status 重建（status="generating" 显示 in-progress，但实际任务可能已死——加一个启动时扫描"超过 5 分钟无心跳的 generating 强制改 failed"）

#### prompt 调整

`buildEsseWorkspaceTurnPrompt` 工作流部分增加：

```
- 用户要新建 N 张图（"生成 4 张鲜花图"）时直接调 run_batch_generation，每条 command 的 target.type='new'。不要先 list_sessions（除非任务引用了左侧现有图片）。
- 生成工具会 fire-and-forget：你 reply 时要说"已提交 N 个任务"，不要说"已经生成完成"。
```

#### 测试

- mock generateImage 用 controlled promise，4 commands 并发触发，断言 4 次 generateImage 同时 in-flight（不是串行 await）。
- 断言 submitImageGenerationBatch 返回时间 ≈ session 创建时间（< 100ms），不是 4 × API 时间。
- mock generateImage 第 2 条 reject → 断言其他 3 条不受影响，sink 收到 1 个 markFailed + 3 个 markCompleted。
- 取消单个：派发后调 cancelItem(sessionId) → 对应 generateImage 收到 abort → sink markCanceled，其他不受影响。
- 取消全部：cancelAll(batchTaskId) → 所有未完成 item 收到 abort。
- Esse turn signal.abort 不影响 batchTaskRegistry 内任务（验证 stop 语义分离）。
- 单图 generate_image 走同一 submitImageGenerationBatch 路径（commands.length=1）。
- 崩溃恢复：mock 启动时 session.status="generating" 且 generation job 超时 → 启动 sweeper 改 failed。
- LLM eval："生成 4 张鲜花图"场景：模型直接调 run_batch_generation + 4 commands，不先 list_sessions，preflight 通过后立即 reply，4 session 出现在工作区。

---

### 2.6 全局记忆

#### 目标

参照 Claude Code 的记忆方式：用户显式触发（"记住 xxx"）→ Esse 工具写入跨项目 Markdown 文件 → 后续每个 Esse turn 自动注入 prompt → 用户可手动编辑文件。

**v1.1 只做全局记忆，不做项目级 memory**。项目本身已经有完整上下文（sessions、chat history、project metadata），再加一层项目级记忆是冗余抽象——项目内的长期偏好通过聊天和工作区状态已经传达，没必要再独立持久化。模型可能记的"项目专属信息"应该回归用户在项目对话里直接说，不进记忆系统。

#### 存储

文件路径：`<userData>/esse-memory.md`，与 `localConfig.json` 同目录。`userData` 走 Electron `app.getPath("userData")`，跨平台。

格式：Markdown，带分类 + ID。例如：

```markdown
# Esse 记忆

## 用户偏好
- [mem_a1b2c3d4] 主要做家居电商主图，倾向干净浅背景
- [mem_e5f6g7h8] 输出默认 2K，除非用户明确说其他尺寸

## 默认约束
- [mem_i9j0k1l2] 不要加任何文字、水印、品牌信息

## 工作流惯例
- [mem_m3n4o5p6] 生成新品时先建 4 张候选，让我挑
```

ID 由 main 生成（nanoid 8 字符），用户编辑文件后保留有 ID 的条目；没 ID 的条目下次任意工具读取时自动补 ID 并写回。三个分类固定（用户偏好 / 默认约束 / 工作流惯例），不支持自定义分类（避免冗余）。

#### 数据访问层

新建 `electron/services/esseMemoryStore.ts`：

```ts
export interface EsseMemoryEntry {
  category: "用户偏好" | "默认约束" | "工作流惯例";
  content: string;
  createdAt: string;
  id: string;
}

export interface EsseMemoryConflict {
  conflictsWith: EsseMemoryEntry;
  ok: false;
  similarity: number;
  suggestedNext: string;
}

export interface EsseMemoryStore {
  list(): Promise<EsseMemoryEntry[]>;
  add(entry: { category?: EsseMemoryEntry["category"]; content: string }): Promise<EsseMemoryEntry | EsseMemoryConflict>;
  remove(id: string): Promise<{ removed: EsseMemoryEntry | null }>;
  renderForPrompt(): Promise<string>;
  getFilePath(): string;
}

export function createEsseMemoryStore(filePath: string): EsseMemoryStore;
```

实现细节：

- 读：每次操作都重读文件（用户可能手动编辑过），不缓存
- 写：原子写（temp 文件 + rename），避免半写入状态
- 缺 ID 的行：读取时自动分配 ID 并在下次写时持久化
- 文件不存在：返回空列表，首次 add 时创建

#### 语义去重（add 时检测）

简单实现：字符串相似度（normalize 后用 Levenshtein 距离归一化）。不引入新 API 调用，纯本地算法。

```ts
function computeMemorySimilarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na === nb) return 1;
  const distance = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 0 : 1 - distance / maxLen;
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　 ]+/g, "")        // 去所有空白（含全角）
    .replace(/[，。、；：""''！？「」【】]/g, "")  // 去中文标点
    .replace(/[,.;:!?"'(){}\[\]]/g, "")        // 去英文标点
    .normalize("NFKC");                          // 全半角统一
}
```

阈值：相似度 ≥ 0.85 视为重复。检测范围：所有现有条目（无 scope 概念）。

`add` 检测到重复时返回 EsseMemoryConflict 而不是直接写入：

```ts
{
  conflictsWith: <既有条目>,
  ok: false,
  similarity: 0.92,
  suggestedNext: "Existing memory: [mem_xxx] xxx. To replace it, forget the existing one first then add the new content. To keep both, rephrase the content more distinctly."
}
```

工具 execute 把这个返回值转成 isError，让模型决定下一步（向用户确认是否覆盖、或合并、或保留差异版本）。**v1.1 不做自动合并/替换**——避免静默丢用户数据。

阈值是否过严会被 LLM eval 验证；如果生产中发现频繁误判，调到 0.9 或对数字 token 单独处理（同 category 内"输出尺寸 2K"和"输出尺寸 4K"数字 token 不同应视为不重复）。

#### 工具集

```ts
{
  name: "remember_user_preference",
  label: "记住用户偏好",
  risk: "safe-write",
  requiresPreflight: false,
  description:
    "Save a piece of user preference, default, or constraint to be remembered across future Esse sessions in any project. " +
    "Use ONLY when the user explicitly asks to remember, save, or note something for future use. " +
    "Do NOT call this proactively from inferred preferences. " +
    "Do NOT use this for project-specific context (e.g. 'this project is for client X'); project context lives in the current chat history and sessions, not in cross-project memory. " +
    "After this tool succeeds, your reply MUST explicitly tell the user what you saved. " +
    "Parameters: content — the preference text in Chinese, concise (under 200 chars); " +
    "category — one of '用户偏好' | '默认约束' | '工作流惯例'. " +
    "If a similar memory already exists, this tool returns isError with the conflicting entry's id and similarity score; ask the user whether to forget the old one and add anew, or to rephrase distinctly.",
  parameters: objectParameters({
    content: "Concise Chinese preference text.",
    category: "Optional category, defaults to '用户偏好'."
  }, ["content"])
}

{
  name: "list_remembered_preferences",
  label: "列出已记忆条目",
  risk: "read",
  requiresPreflight: false,
  description:
    "List all currently remembered user preferences with their ids and categories. " +
    "Use when the user asks what Esse remembers, or before forget_user_preference.",
  parameters: objectParameters({}, [])
}

{
  name: "forget_user_preference",
  label: "删除记忆条目",
  risk: "destructive",         // 经 broker
  requiresPreflight: false,
  description:
    "Delete one remembered preference by id. " +
    "Use when the user asks to forget, remove, or no longer apply a specific remembered item. " +
    "After this tool succeeds, your reply MUST explicitly tell the user what you removed.",
  parameters: objectParameters({ memoryId: "Id from list_remembered_preferences." }, ["memoryId"])
}
```

注册位置：和 workspace tools 一起在 `createEsseWorkspaceTools` 后挂上（memory 工具不依赖 ProjectSnapshot，可以独立 runtime 注入，但放在同一 customToolDefinitions 数组里）。

`EsseWorkspaceToolRuntime` 增加可选字段：

```ts
interface EsseWorkspaceToolRuntime {
  ...existing...
  memoryStore?: EsseMemoryStore;
}
```

工具 execute 在 runtime.memoryStore 缺失时返回 isError "memory unavailable"（测试环境可不注入）。

#### prompt 注入

`buildFullEsseWorkspacePrompt` 和 `buildEsseWorkspaceTurnPrompt` 起手新增：

```ts
const memorySection = await memoryStore.renderForPrompt();
// memorySection 为空字符串时不插入这一段
```

`renderForPrompt` 返回格式（无记忆时返回空字符串）：

```
==== 全局记忆（用户跨项目偏好，必须遵守）====
用户偏好：
- 主要做家居电商主图，倾向干净浅背景
- 输出默认 2K，除非用户明确说其他尺寸

默认约束：
- 不要加任何文字、水印、品牌信息

工作流惯例：
- 生成新品时先建 4 张候选，让我挑

记忆管理规则：
- 在做决策时优先遵守上述记忆中的偏好和约束
- 用户说"记住 xxx"时调 remember_user_preference，调完后 reply 里告诉用户记住了什么
- 用户说"别记 xxx" / "忘了 xxx"时先 list_remembered_preferences 找到对应 id 再 forget_user_preference，并在 reply 里告诉用户删了什么
- 如果 remember 返回 similarity conflict，先告诉用户现有条目，问"要替换吗"再决定是否 forget+重新 add
- 不要把项目专属内容（"这个项目是某客户的"这类）写进全局记忆；项目上下文已经在 sessions 和聊天历史里
```

#### 更新告知

走两条线，模型只需做一件事：

1. **toolCallSink 自动产生 chat context**：`Esse 工具调用：记住用户偏好（完成） 结果：已记录新记忆 mem_xxx：xxx`——免费的可见性。
2. **Esse reply 主线告知**：prompt 已硬约束"调 remember/forget 后必须在 reply 中告诉用户具体内容"。模型如不遵守会被 LLM eval 抓到。

不做单独的"记忆更新通知 UI"，避免噪声。

#### 边界

- 记忆条目内容长度上限 200 字符（超长 isError，让模型自己压缩）
- 总条目上限 100（超限时 add 返回 isError "memory full, forget some first"）
- prompt 注入总字符上限 2000（接近时 renderForPrompt 自动截断并附"更多记忆请用 list 工具查看"）
- forget 删除后立即从 prompt 注入移除（下一轮 turn 生效）
- 用户直接编辑文件破坏 ID 格式 → 读取时跳过该行，不报错（容错）

#### 测试

通用：

- add + list → 持久化正确
- 重启 main 后 list 仍能读到（文件 round-trip）
- forget 后该 id 从 list 和 renderForPrompt 中消失
- 用户手动删除文件 → list 返回空
- 用户手动编辑文件加无 ID 行 → 下次 list 时自动补 ID 并写回
- 同时两次 add 并发：原子写，最终文件包含两条
- 内容超 200 字符 isError
- 总数达 100 后 add isError
- prompt 注入接近 2000 字符时截断 + 提示

语义去重：

- add 相同内容 → 返回 conflict，similarity=1
- add normalize 后相同（标点空白差异）→ conflict，similarity=1
- add 内容差异 < 15% → conflict
- add 内容差异 ≥ 15% → 正常写入
- 不同 category 仍去重（同内容放不同 category 没意义）

LLM eval（新增场景）：

- "记住我做家居电商主图" → 模型调 remember + reply "已记住：你做家居电商主图"
- 下一轮 "生成一张商品图" → 模型在 generate_image preflight 的 prompt 中体现该偏好（白底、家居场景等）
- "忘了刚才那条" → 模型先 list 找 id 再 forget + reply 反映删除内容
- "记住我做家居电商主图"（已有相似条目）→ 模型收到 conflict isError → reply "你已经记过类似的：xxx，要替换吗？"，不强行 add
- "记住这个项目是某客户的春季新品" → 模型不调 remember，reply 解释"项目专属信息不需要写进全局记忆，我会在当前对话里记住"（负例：项目专属不进全局）

---

### 2.7 工作区扩展工具（split / duplicate）

#### 目标

补齐 v1.0 没做的两个工作区操作，让 Esse 能处理"把某些记录单独拆出来"、"复制一个 session 做对比版本"这种常见场景。两个工具都通过现有 mutationSink + reducer 路径，加 undo 支持。

#### split_session

```ts
{
  name: "split_session",
  label: "拆分图片",
  risk: "destructive",
  requiresPreflight: false,
  description:
    "Split a session's generated records into a new session. " +
    "The selected records move to a new session; the source session keeps the remaining records. " +
    "Use when the user wants to separate some generated records of a session into an independent image (e.g. 'img-2 的记录 3、4 其实是另一张图，单独拆出来'). " +
    "Call list_sessions and get_session_records first to know record indexes. " +
    "Parameters: sessionId — source session stable id; recordIndexes — 1-based record indexes to move out (at least 1, must leave source with at least 1 remaining record); fileName — optional display fileName for the new session.",
  parameters: objectParameters({
    sessionId: "Stable source session id.",
    recordIndexes: "1-based record indexes to move into the new session.",
    fileName: "Optional fileName for the new session."
  }, ["sessionId", "recordIndexes"])
}
```

reducer 行为 `applySplitSession(state, params)`：

- 校验：source 存在；recordIndexes 全部合法；不能拆走全部记录（避免源变空，应该用 delete_session）；recordIndexes 去重
- 新 session id 用 nanoid 生成
- 新 session.originatedFromGeneration = true（因为它由生成图组成，没有原图）
- 新 session.filePath = 被拆走的第一张记录的物理路径
- 新 session.generatedFilePath = 同上
- 新 session.generatedFilePaths = 被拆走的记录按 recordIndexes 顺序排列
- 源 session.generatedFilePaths 移除被拆条目
- 源 session 当前图如果指向被拆条目，fallback 走现有 deleteRecord 同款逻辑
- 关联的 chat message 不迁移（仍属于源 session），但被拆条目的 message.generatedFilePath 清空（同 deleteRecord 行为）

#### duplicate_session

```ts
{
  name: "duplicate_session",
  label: "复制图片",
  risk: "safe-write",
  requiresPreflight: false,
  description:
    "Duplicate a session including all its generated record references. " +
    "The new session has its own stable id and inherits the source session's originatedFromGeneration flag; underlying image files are NOT copied, both sessions reference the same paths. " +
    "Use when the user wants a parallel copy to experiment on without affecting the original. " +
    "Parameters: sessionId — source session stable id; fileName — optional display fileName for the duplicate.",
  parameters: objectParameters({
    sessionId: "Stable source session id.",
    fileName: "Optional fileName for the duplicate."
  }, ["sessionId"])
}
```

reducer 行为 `applyDuplicateSession(state, params)`：

- 校验：source 存在
- 新 session id 用 nanoid 生成
- 复制 source 的 filePath / generatedFilePath / generatedFilePaths / generationMode / lastPrompt / showOriginalInList / originatedFromGeneration
- 不复制 chatMessages（fresh chat history）
- 不复制 status（新 session.status = "completed"，因为它已经是完成态的副本）
- 不复制 errorMessage
- selectedSessionId 切到新 session

#### Undo 支持

两个工具都注册 inverse descriptor：

- split_session 的 inverse：`{ kind: "merge-into-source"; targetSessionId: <new>; sourceSessionId: <original>; originalGeneratedFilePaths: [...] }` —— 把 new session 的记录按原顺序并回 source，删除 new session
- duplicate_session 的 inverse：`{ kind: "delete-session"; sessionId: <new> }` —— 直接删 new session

inverse descriptor 加入 `SerializableUndoDescriptor` 类型联合体（见 2.2 Undo 工具章节）。

#### 与文件引用计数的关系

duplicate 后两个 session 共享同样的 generatedFilePaths 物理路径。`scan_unreferenced_files` 已经基于 collectReferencedPaths 走 set 去重，不会因为 duplicate 误判文件未引用。删除其中一个 session 也不会让物理文件变成 unreferenced（另一个仍引用着）。

split 把记录从 source 移到 new，total 引用计数不变；物理文件不动。

#### 测试

split：

- 移走 1 条记录 → 新 session 含该记录，源失去该记录
- 移走多条 → 新 session 按 recordIndexes 顺序排列
- 试图移走全部记录 → isError，建议改用 delete_session
- recordIndexes 包含越界 → isError
- 源当前图被拆走 → 源切到 fallback
- chat message 同步清空 generatedFilePath
- undo split → 状态完全相等（深度比较 snapshot）

duplicate：

- 新 session id ≠ 源，但 filePath / generatedFilePaths 相同
- 新 session.chatMessages = []
- 新 session.originatedFromGeneration 继承源值
- selectedSessionId 切到新 session
- undo duplicate → 新 session 消失，selectedSessionId 回到 undo 前
- 删除原 session 后物理文件仍被新 session 引用，scan_unreferenced_files 不返回这些文件

LLM eval（新增场景）：

- "把 img-2 的记录 3、4 拆成一张新图" → 模型调 list_sessions / get_session_records / split_session + reply 反映拆分结果
- "复制一份 img-1，我想对比着改" → 模型调 list_sessions / duplicate_session + reply 提示新 session 已选中
- "撤销刚才的拆分" → 模型调 undo_last_actions（依赖 2.2 已就绪）

---

## 实施步骤

按"先修后做、新功能按用户痛点排序"原则，每步独立 PR。

1. **Bug A**: persona prompt 修正 + 测试。
2. **Bug B**: applyMutation 去 preview + 并发测试。
3. **Bug C**: applyProjectSnapshotMutation 包 tx + 测试。
4. **Bug D**: 死代码清理。
5. **Plan 对齐 A**: Turn 边界 + 4 个测试。
6. **Plan 对齐 B**: generate_image 共享 builder 抽取。
7. **关注点 7+9**: sink registry assert + broker reject 清理。
8. **测试缺口 11-14**: 一次性补上。
9. **Part 2.5a 全新生成 session 图片身份修复**（优先，先修占位图语义）: originatedFromGeneration 字段 + reducer 改造 + migration 启发式 + restore/list/records 语义 + LLM eval。
10. **Part 2.5b 批量任务派发 + 取消/重试**: submitImageGenerationBatch + batchTaskRegistry + batch-task 卡片 + IPC 取消/重试 + stop 语义分离 + 持久化 retry command + LLM eval。这一步仍是 v1.1 最大的 PR，但不再和图片身份修复混成一包。
11. **Part 2.3a 项目级参考图 schema**: ProjectSnapshot.referenceImages + SQLite round-trip + save snapshot 透传 + IPC 边界测试。
12. **Part 2.3b 参考图工具**: 三个工具 + reducer + LLM eval。
13. **Part 2.6 全局记忆**: esseMemoryStore + 三工具 + 语义去重（Levenshtein）+ prompt 注入 + LLM eval。
14. **Part 2.1 Broker 收紧**: policy + broker + IPC + Permission 卡片 UI + LLM eval。
15. **Part 2.2 Undo 工具**: reducer inverse + undo log 持久化 + undo_last_actions 工具 + 测试。注意：split / duplicate 的 inverse descriptor 在 2.7 完成时一并注册。
16. **Part 2.4 Preflight modify**: IPC 协议 + UI 编辑模式 + 工具侧处理 + 测试。
17. **Part 2.7 工作区扩展工具**: split_session + duplicate_session + reducer + inverse descriptor 接入 undo（依赖 2.2 已就绪）+ LLM eval。

硬约束：

- 步骤 1-4 必须先合，避免在 buggy 基础上叠加新功能。
- 步骤 6（generate_image 共享 builder）必须先于步骤 9（批量派发），后者依赖单图/批量执行层合并。
- 步骤 9 必须先于步骤 10，避免 batch 派发继续扩大 blank seed 语义错误。
- 步骤 10 实现时不能在 `ProjectMutationSink.apply` mutator 中做 async IO；blank seed 和 command 快照准备在事务外，sink 内只提交状态。
- 步骤 11 必须先于步骤 12；没有项目级 referenceImages 真源时不要注册参考图管理工具。
- 步骤 14（broker 收紧）默认 policy 切到 ask 后所有 destructive 工具行为有变，需要在 release notes 明确告知用户"Esse 删除操作现在会先问你"。
- 步骤 15（undo）依赖步骤 5（turn 边界）的工具计数机制，先做步骤 5。
- 步骤 10 与步骤 14 顺序敏感：若先做 14 再做 10，会出现"批量提交 4 张图弹 4 次 broker 卡片"的体验灾难。先做 10 让任务派发跑通后再上 ask，且 ask policy 设计要识别 batch context（同一 batchTaskId 内多个 destructive write 只问一次）。
- 步骤 17（split / duplicate）必须在步骤 15（undo）之后或同 PR：split/duplicate 的 inverse descriptor 写入 undo log，依赖 undo log 持久化结构已就绪。

---

## 风险与权衡

- **broker 切 ask 让 Esse 体验变碎**。v1 的"流畅多步执行"印象会被打破，特别是模型连续调多个 destructive 工具时用户要点多次。缓解：(1) `targetKey` 让同 session 同操作本 turn 只问一次；(2) "本次会话允许"选项让用户在了解 Esse 意图后批量授权；(3) safe-write 默认仍 allow，常见操作（restore / rename / reorder）不打断。
- **Undo 不能恢复物理操作**。generate_image / package / delete_unreferenced 不可逆，用户预期可能不一致。对策：undo 工具 description 明确写出哪些不可逆；undo 返回结果里报告"跳过 N 个不可逆操作"。
- **Undo 日志膨胀项目快照**。v1.1 实际采用完整 workspace state 快照作为 inverseDescriptor。小项目可接受，但 100 张图项目里单条 entry 可能达到数百 KB，50 条上限可能让 SQLite 增长到数十 MB。当前通过 50 条 FIFO 控制上限，并用 sink revision 提示中间写入风险；如果生产中存储或语义成本过高，v1.2 再切换到 per-tool inverse 或 diff-only。
- **Preflight modify 让模型"以为"自己提交了 prompt A，实际执行 B**。日志和后续 chat 必须明确显示"用户修改后执行：prompt 改为 B"；模型在下一轮 turn 看到的 reply 也应该反映修改。否则模型可能基于错误前提继续推理。
- **add_reference_image 的"turn-内路径"约束依赖 SendEsseMessageRequest.referenceImagePaths 的完整性**。如果该字段在 IPC 传输中被裁剪或某些 case 漏传，工具会拒绝合法操作。需要在 IPC 边界加 schema 校验，并在工具失败时给出明确 hint。
- **全新生成 session 的 filePath 语义改变会影响现有代码 assumption**。许多地方（getCurrentImagePath、SessionPanel 缩略图渲染、`generation:generate-image` IPC handler 的 imagePath 传参）默认 filePath 是"原图"语义。改成"全新生成 session 的 filePath = 第一张生成图"后，所有读 filePath 的位置都要 audit 是否仍正确——多数应该自然正确（filePath 是有效图片路径就行），但 mode="edit" 走 imageSessionAgent 直接生成时，如果用户对全新生成 session 触发 edit，imagePath 会传第一张生成图，这是对的；要重点测 `getCurrentImagePath` 的所有 caller。
- **Migration 启发式 false-positive 风险**。如果用户导入的图正好叫 `<sessionId>-seed.png`，会被误标记为 originatedFromGeneration=true，restore_original 行为改变。对策：blank seed 命名模式更严格（加 `.blank-seed.png` 后缀），migration 只匹配新模式；v1.1 之前的 blank seed（无此后缀）由 migration 通过"filePath 文件大小 < 1KB 且尺寸固定"双重校验避免误判。
- **批量 fire-and-forget 后失败不再主动通知模型**。任务在后台失败 → session.errorMessage 写入 → 卡片标红 + 工作区标红。但 Esse 当前 turn 已结束，模型在 reply 里说"已提交"后不会自动汇报失败。这是有意取舍：模型不应该把 turn 挂着等所有任务完成。用户在下一轮问"刚才那批怎么样了"时，模型调 list_sessions 看到 failed status 才汇报。在 prompt 中要明确这条工作流，避免模型 reply 时承诺"完成后我会告诉你"（它不会）。
- **批量任务的崩溃恢复成本**。fire-and-forget 后 app 中途崩溃，已派发但未完成的任务在 sink 里是 status="generating" 但实际任务已死。`recoverInterruptedGenerationJobs` 必须配合 sweeper（启动时把"超过 X 分钟无进展的 generating 改 failed"）。X 取值要谨慎：太短会误杀真正在跑的长任务，太长会让僵尸状态显示太久。建议 15 分钟。
- **batch-task 卡片的状态实时性**。卡片渲染依赖 sessions[sessionId].status，状态变化通过 `project:snapshot-updated` 推送过来。如果 renderer 错过一次推送（窗口隐藏等），卡片会显示过期状态。renderer 需要在重新获得焦点时主动 refetch snapshot（项目级，不只针对卡片）。
- **全局记忆污染单项目**。全局 memory 在所有项目里都加载。如果用户错误地说"记住这个项目是某客户的"，模型按 prompt 约束应该拒绝写入并解释"项目专属信息走聊天历史不进全局记忆"，但模型可能不遵守。对策：(1) 工具 description 和 prompt 双重约束反例；(2) LLM eval 加入负例场景验证模型识别"项目专属"；(3) 用户手动 forget 是兜底。
- **记忆条目质量依赖模型自觉**。模型可能记口语化无效内容、记暂时性偏好。语义去重靠字符串相似度只能挡完全字面重复（"白底"vs"白色背景"挡不住），治标不治本；v1.2 用 embedding 做真语义去重。生命周期管理（自动过期 / 衰减）也留 v1.2。当前靠 prompt 约束模型"记忆是长期偏好，不要记一次性的临时要求"+ 用户手动 forget。
- **语义去重的字符串相似度阈值 0.85 可能过严或过松**。生产中观察一段时间后可调。同 category 内的"输出尺寸 2K"和"输出尺寸 4K"会因数字之外字面高度相似可能被误判 → 实施时把数字 token 单独提出来比较（如果数字 token 不同直接判为不重复）。
- **batch 失败重试上限 3 次的取舍**。3 次是经验值——超过 3 次大概率是参数本身有问题（prompt 不合适 / 输入太复杂），继续重试浪费 API。但用户可能因网络抖动遇到连续 3 次失败的真实场景。对策：3 次后按钮变灰但 tooltip 引导用户"新建任务用相同参数"绕开上限；如果生产中发现 3 次不够，可调整。
- **split_session 中拆走当前图导致 source fallback 的语义**。如果 source 当前图正好被拆走，source 切到 fallback 是合理的；但用户可能困惑"我只是拆出去一张图，怎么源图变了"。对策：拆完后 Esse reply 明确告知"源图当前显示已切到记录 N"。LLM eval 加这条断言。
- **stop 语义分离需要 release notes 清楚说明**。用户习惯"按停止 = 全停"。改成"停止只停 Esse 推理，已派发任务继续"后，要在 UI 上明确（停止按钮的 tooltip、首次使用提示），并在 batch-task 卡片上突出"全部取消"按钮的位置。否则用户会以为停止按钮坏了。
- **Plan 与代码长期对齐成本**。每次新增工具都要同步更新工具描述、Esse prompt few-shot、LLM eval；v1.1 工具数量上升后这件事更重。考虑引入 codegen：工具定义 → 自动生成 prompt 段落 + eval 模板。v1.2 议题。

---

## v1.2 候选（不在本计划）

- 跨项目 agent：`list_projects` / `switch_project` / `open_project_in_new_window`。
- writeProjectSnapshot 增量 diff 写入（替代全量 delete+insert）。
- 真实 LLM eval 稳定化 `run_batch_generation`（解决 180s 超时；v1.1 改 fire-and-forget 后这条多半自动解决，仍需验证）。
- 长 turn 上下文压缩：tool 调用历史超阈值后摘要替代。
- Undo redo 支持。
- 用户面 settings UI 配置 permission policy（取代 hardcoded 默认）。
- agent telemetry dashboard：turn 平均长度、工具调用分布、preflight cancel 率、permission deny 率、batch 任务并发数、记忆使用统计。
- renderer legacy BatchPlan 执行路径下沉到 main + mutationSink。
- 真语义去重：用 embedding 替换 v1.1 的字符串相似度，处理"白底"vs"纯白色背景"这种语义等价但字面不同的情况。
- batch 失败项的"用修改后的参数重试"：v1.1 重试用原参数，v1.2 加 inline 编辑入口。
