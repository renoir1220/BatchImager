# Esse Workspace Agent Plan（深度评估与工具执行版）

## 背景与定位

目标：让 Esse 像 Claude Code / Codex 操作开发项目一样，操作 BatchImager 的图像处理项目——通过一组受限工具读取并修改工作区状态，能多步推理、可观测，main 进程是状态权威。

当前 Esse 是"一次性返回 reply + imageRequests/plan 的结构化响应器"，遇到工作区数据操作（"回退 img-1 到记录 1，删除记录 2"）时会被误判成图片生成。根本原因不是 prompt 不够强，而是 Esse 没有非图片的执行能力，所有意图都只能挤进 imageRequests 这一条路径。

本计划完成以下三件事：

1. 把 Esse 重构成 customTool-only 的 agent：所有外部副作用（看工作区、改记录、生成图、批处理、打包）都走 pi tool-use 循环，不再依赖 JSON 字段解析。
2. 把 main 进程立为项目状态的唯一权威：工具直接 mutate projectStore + persist + 广播 snapshot；renderer 改为被动 reconcile。
3. 两种用户保护机制并存且独立：**permission broker**（默认放开，将来收紧）管"危险操作"；**preflight sink**（永远生效）管"贵且慢的 imagen API 调用"。

最终形态不保留双写：`workspaceActions` 提议路径不要、`imageRequests` / `plan` / `fileTasks` 这些字段迁到工具、renderer 调 `persistProjectSnapshot` 的入口废弃（统一走 main）。实施上允许按垂直切片推进，但每个切片必须能独立验收：从用户话术 → agent 工具调用 → main 事务落盘 → renderer 被动更新 → 测试/评估记录，缺任何一环都不算完成。

## 深度验收口径

不能只证明"注册了工具"或"prompt 写了规则"。Esse 的 agent 能力必须按下面四层同时验收：

1. **意图路由正确**：用户说"删除左侧第二张图"、"把 img-1 回退到记录 1"时进入工作区工具链；用户说"删除背景"、"去掉水印"时仍走图片生成/编辑路径，不能误删工作区。
2. **先读后写**：涉及 `img-1`、"第二张图"、"记录 2"这类 UI 表达时，必须先 `list_sessions` / `get_session_records` 映射稳定 id 和 1-based recordIndex；直接把 displayLabel 当 sessionId 写入算失败。
3. **真实副作用闭环**：写工具必须修改完整 `ProjectSnapshot`，通过 main 的 transaction + mutation sink 落盘，并广播 `project:snapshot-updated`；renderer 只被动 reconcile。只改前端内存或只改测试假对象不算通过。
4. **用户成本保护**：评估默认不调用 imagen API。生成类工具用 preflight/stub 验证参数、调用次数和取消语义；只有人工明确 smoke test 时才打真实图像 API。

### 当前优先验收切片：左侧工作区记录操作

第一阶段不追求一次性覆盖全部工具，而是先把最容易伤数据、也最能证明 agent 能力的工作区切片做实：

| 用户任务 | Esse 应有链路 | 验收点 |
| --- | --- | --- |
| "把 img-1 回退到记录 1，然后删除记录 2" | `list_sessions` → `get_session_records` → `restore_session_record` → `delete_session_record` → reply | 当前图切到记录 1；记录 2 从 `generatedFilePaths` 移除；指向记录 2 的 chat message 生成路径清空；无图像 API 调用 |
| "删掉左侧第二张图" | `list_sessions` → `delete_session` → reply | 删除的是第二个 displayLabel 映射到的稳定 sessionId；`selectedSessionId` 回落到相邻图片；项目快照落盘并广播 |
| "把第二张图的生成记录并到第一张，第二张不要单独留着" | `list_sessions` → `merge_sessions` → reply | 目标 session 保留原顺序并追加源记录；源 session 被移除；聊天记录并入；选中源图时切回目标 |
| "删掉左侧第二张图，然后把现在第二张重命名为 hero.jpg" | `list_sessions` → `delete_session` → `list_sessions` → `rename_session` → reply | 删除后 displayLabel 发生位移，必须重新读取工作区再解析“现在第二张”，不能沿用旧 img-2 映射 |
| "删除背景并换成白底" | 非工作区工具链 | 不调用 `delete_session` / `delete_session_record`；进入生成/编辑计划或 preflight |

这组切片通过后，才能说 Esse "能处理左侧工作区删除图片/记录这类任务"。后续工具（rename/reorder/scan unreferenced/generate preflight）沿用同一评估模板扩展。

### 当前可执行评估入口

Esse 评估分两层：

1. `npm run eval:esse`：快速、确定性的离线回归评估，默认不调用 LLM，也不调用图像 API，用来约束 reducers、runtime、preflight、参数归一化和 fake tool-use harness。
2. `npm run eval:esse:llm`：真实 LLM 工具选择评估，会调用本地配置的 LLM，但仍然不调用图像生成/编辑 API；`generate_image` 和 `package_generated_images` 使用 fake executor，只验证模型是否选对工具、preflight 参数是否合理、工作区副作用是否落到 snapshot。

`npm run eval:esse` 当前覆盖这些证据：

- `electron/services/esseWorkspaceAgentEvaluation.test.ts`：用 fake runtime 驱动 `runEsseAgentTurn` 注册并调用真实 workspace custom tools，覆盖删除后重新 `list_sessions`、"删除背景"进入生成 preflight 而非删除工作区、打包生成图 0 API 调用等用户话术。
- `src/domain/projectWorkspaceAgentEvaluation.test.ts`：用模拟用户任务评估工作区工具链，包括回退/删除记录、删除左侧图片、displayLabel → stable id、合并记录、安全写动作，以及"跳过先读后写"的负例。
- `electron/services/esseWorkspaceRuntime.test.ts`：验证真实 Electron 工具通过 `ProjectMutationSink<ProjectSnapshot>` 持久化、失败不广播、工作区意图路由不把"删除背景/移除水印"误判为删除图片；同时验证生成类工具必须先走 preflight，用户取消时不执行且返回 do-not-retry 提示；生产 runtime 开启后，每次工具调用会落一条 `esse-tool-call` context message 到项目对话，便于追踪；`read_image_metadata` 只按 session/record 引用返回尺寸、格式、字节数，不暴露 filePath。
- `electron/services/esseImagePreflightExecutor.test.ts`：验证用户确认 preflight 后，生成工具会调用注入的生成执行体，并通过 mutation sink 把 existing/new session 的生成结果写回项目快照；测试使用 fake generator，不调用图像 API。
- `electron/services/essePackagePreflightExecutor.test.ts`：验证打包/导出生成图走注入的 zip 执行体，只能按稳定 sessionId 或全项目生成图收集，不调用图像 API；没有生成图时不会误写桌面文件。
- `electron/services/essePreflightBroker.test.ts`：验证 `esse:preflight-request` / `esse:preflight-response` 的等待契约，包括执行、取消、超时自动 cancel、用户停止时 abort。
- `electron/services/projectUnreferencedFiles.test.ts`：验证未引用生成文件扫描/物理删除的安全边界：工具只暴露 `candidateId`，不暴露裸路径；删除前重新扫描，候选被重新引用时跳过。

`npm run eval:esse:llm` 当前覆盖这些真实模型场景：

- "删掉左侧第二张图"：真实 LLM 必须调用 `list_sessions` / `delete_session`，最终 snapshot 删除稳定 id 对应的第二张。
- "把 img-1 回退到记录 1，然后删除记录 2"：真实 LLM 必须调用 `list_sessions` / `get_session_records` / `restore_session_record` / `delete_session_record`，最终当前图回到记录 1，记录 2 被逻辑删除。
- "删掉左侧第二张图，然后把现在第二张重命名"：真实 LLM 必须在删除后重新 `list_sessions`，再用新的稳定 id 调 `rename_session`，验证 displayLabel 位移后的多步能力。
- "看一下左侧第一张当前图的尺寸和格式"：真实 LLM 必须先 `list_sessions`，再调用 `read_image_metadata`；评估创建本地小 PNG，验证返回 width/height/format 且不泄露路径。
- "先给项目添加一个空白图片位"：真实 LLM 必须调用 `add_blank_session`，不调用 `generate_image`，不触发 preflight；评估验证本地透明 PNG 占位图被创建，项目新增 session 并选中它。
- "把左侧第一张删除背景并换成白底"：真实 LLM 必须调用 `generate_image` preflight，不能调用 `delete_session`；fake executor 只计数，不打图像 API。
- "把所有生成图打包到桌面"：真实 LLM 必须调用 `package_generated_images`，preflight `estimatedApiCalls=0`，fake executor 不写真实桌面文件。
- "扫描并清理未引用的生成图"：真实 LLM 必须先 `scan_unreferenced_files`，再把候选 `candidateId` 传给 `delete_unreferenced_files`；评估在临时项目里真实创建 referenced/orphan 文件，验证只删除 orphan，不暴露 filePath。

最近一次真实 LLM eval 暴露的有效问题：模型会按工具 schema 把 `recordIndex` 传成字符串（如 `"1"`），而工具实现只接受 number，导致记录工具全部失败。调优方式是修正工具参数解析，安全接受数字字符串，而不是靠 prompt 要求模型背内部类型细节。

另一个真实模型可用性调优：`scan_unreferenced_files` 不能只把 `candidateId` 放在结构化 details 里，工具结果正文也要列出 `candidateId/fileName/byteSize`（仍不含路径），这样真实 LLM 能稳定把候选传给下一步删除工具。

可观测性进展：Electron workspace runtime 已支持 `recordToolCalls`，生产 Esse 工作区工具每次调用后会通过同一个 `ProjectMutationSink` 写入一条 `role=context, contextType=esse-tool-call` 的项目对话消息。读工具、写工具、preflight 工具都可追踪，且结果摘要会截断，避免把工具细节刷屏。

真实 LLM eval 已按场景拆分成多个独立 test。这样不会因为整组串行超过单个测试超时而误判失败，也能直接定位是哪条用户任务慢或失败。

最新真实 LLM eval 还暴露了“可工具完成的动作偶发只口头答应”的问题，先在通用 workspace prompt 中明确：能由工具完成的动作必须先调用工具；同时强化 `generate_image` / `package_generated_images` 的 description，避免删除背景、打包导出这类请求只停在文本回复。

本轮真实 LLM eval 再次证明了这条约束的必要性：打包到桌面场景里，模型曾回复“请确认后我就执行”但没有调用 `package_generated_images`。修正方式不是把打包流程写成硬编码编排，而是在 workspace prompt 和工具 description 中明确“preflight 卡片由工具调用触发，不能用文字确认替代工具调用”。

批量编辑场景已进入离线 workspace eval：`"把左侧第一张和第二张批量处理成手持展示姿势"` 必须走 `list_sessions` → `run_batch_generation`，并产生一次 `estimatedApiCalls=2` 的 preflight。真实 LLM 自动 eval 曾尝试加入同场景，但连续触发 180s 超时；当前结论是 `run_batch_generation` 的真实模型路由还需要进一步缩短上下文或增加工具级可恢复约束后再设为自动门禁，不能用不稳定长测假装完成。

普通 Esse 里的批量方案类话术已从旧 `plan` JSON 分支迁到 workspace tool 路由：`"帮这批图做一套春季电商主图方案"` 现在进入 `run_batch_generation` preflight，而不是先生成 `BatchPlan` JSON。服务层旧 `runEssePlanTurn`、`parseEsseResponse`、`normalizeEsseResponse`、`imageRequests / plan / fileTasks` 文本 JSON 解析测试已经删除，避免长期双路径。

普通 `esse:send-message` 生产路径已默认创建 workspace tool runtime，不再按启发式决定是否启用工具；IPC 响应也收窄为 `{ reply }`，renderer 不再把 `imageRequests` 转成旧方案卡，main 也不再执行 legacy `fileTasks` 打包。未使用的 `project-manager:create-plan` IPC / preload 方法 / request-response 类型已删除。`runEsseAgentTurn` 的无 workspace-runtime 兼容路径也只允许自然语言回复，不再解析模型输出里的结构化字段。

真实 LLM eval 的超时现在必须先做归因：`npm run eval:esse:llm` 会先跑 `esseLlmSmoke.llm.test.ts`，只创建 runtime 并要求模型回复 `OK`，不注册 workspace tools，也不调用图像 API。若 smoke 超时，说明当前 LLM API/runtime 本身没有及时返回，workspace agent 场景会被跳过并明确失败原因；若 smoke 通过，再跑 8 个 workspace LLM 场景。最近一次故障诊断显示：runtime 创建成功，但 minimal prompt 45s 超时，且 workspace 场景诊断为 `trace=[] / toolCalls=[] / preflightCount=0`，因此该次不是工具执行或图像 API 问题。

最新验证结果：

- `npm run eval:esse`：7 个 eval 文件 / 48 个用例通过，0 图像 API 调用；旧 JSON e2e eval 已删除，评估门禁只覆盖 workspace tool 路径。
- `npm run eval:esse:llm`：真实 LLM 8 个场景通过，`generate_image` / `package_generated_images` 都使用 fake executor，0 图像 API 调用。
- `npm test`：56 个文件通过、2 个文件 skipped；329 个用例通过、9 个 skipped。
- `npm run typecheck`：通过。
- `npm run build`：通过，仅保留 Vite chunk size warning。

删除记录 UI 进展：`delete_session_record` 会清空指向被删记录的 `chatMessages[*].generatedFilePath`；`SessionPanel` 现在对 `contextType="generated-image"` 但无 `generatedFilePath` 的消息渲染“记录已删除”占位，避免坏缩略图和 404 预览入口。

后续每新增一组 Esse 工具，都必须扩展离线评估；涉及模型路由质量的工具，还必须扩展真实 LLM 评估。不要只加单元测试而不跑模型。

### Agent 最佳实践护栏

- 工具描述承担路由语义，prompt 只写工作流原则和少量 few-shot；不要靠巨型 prompt 枚举所有中文说法。
- 工具参数使用稳定 id / recordIndex / candidateId，不接受裸 filePath，不让模型持有任意文件删除能力。
- 写工具保持小粒度、可回放、可观察；不要写一个"do_workspace_task"大工具把编排藏进代码。
- 评估要包含 negative cases，证明系统能拒绝错误路线，而不是只测 happy path。
- 为了提高分数而特判测试用语，或者让 prompt 直接背答案，算违背最佳实践。

## 设计原则

1. **多窄工具，不批量。** 每个工具一件事，参数最小集，便于写 prompt example、写单测、便于 LLM 学会。
2. **读写都要有。** 没有读工具，写工具就只能猜。模型必须能先 list 再 act。
3. **工具即执行。** 工具在 main 进程真改 state，不做"草稿 + 确认"循环。
4. **main 是唯一权威。** Sessions 与项目状态的写权全部下沉到 main 的 projectStore；renderer 订阅 `project:snapshot-updated` 被动 reconcile。
5. **多轮循环。** Esse 的 turn 结束条件是模型输出最终文本（不再调工具），不是返回第一个工具结果就停。
6. **Broker 与 preflight 解耦。** Broker 关心"危险性"（v1 默认 allow），preflight 关心"API 成本与等待代价"（v1 永远生效）。两者独立判定，独立配置。
7. **可观测优先。** 每次工具调用在 chat 中作为 context message 落地，参数 + 结果摘要可见。
8. **统一工具体系。** imageRequests / plan / fileTasks 这些"伪工具"也迁成真 customTool，不留两套并行机制。
9. **工具不接受裸路径。** 凡是涉及文件的工具入参必须是 sessionId / recordIndex / candidateId / 受工具自身校验过的引用。模型永远不操作裸 filePath，避免任意文件入口。

## 工具体系 v1

每个工具同时声明两个独立标签：

```ts
risk: "read" | "safe-write" | "destructive" | "external-write"; // broker 路由依据
requiresPreflight: boolean;                         // 是否走 preflight 卡片
```

当前实现已在 `BatchImagerAgentTool` 上声明 `risk` / `requiresPreflight`，并在 workspace runtime 注入默认 allow 的 `requestPermission`。`requiresPreflight=true` 的工具在 permission allow 后仍然必须走 preflight，两者不会合并。

### 工作区读（risk: read, preflight: false）

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `list_sessions` | 返回所有 session 概要：id（稳定 token）/ displayLabel（"img-1" 渲染序号）/ fileName / generatedRecordCount / currentImageSource / status | — |
| `get_session_records` | 单个 session 的全部生成记录：fileName / recordIndex / 是否当前图 | `sessionId` |
| `get_project_overview` | 项目名 / 根目录 / 生成图总数 / 参考图总数 / 选择中的 sessionId | — |
| `read_image_metadata` | 图片尺寸 / 字节大小 / 类型（原图/生成/参考），按 session 引用 | `sessionId`, `recordIndex?`（不传=当前图） |
| `scan_unreferenced_files` | 扫描项目生成目录下未被任何 session/message 引用的文件，**只读，不删** | — |

读工具直接从 main 内存态读取，零持久化、零 IPC 到 renderer。`list_sessions` / `get_session_records` 不向模型暴露本地文件路径；`scan_unreferenced_files` 返回 `{ candidateId, fileName, byteSize, lastReferencedBy?: string }[]`，不暴露真实 filePath。`candidateId` 由 main 根据当前扫描结果生成，只能用于后续 `delete_unreferenced_files`。

### 工作区写（risk: safe-write, preflight: false）

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `restore_session_record` | 切换当前图为指定记录 | `sessionId`, `recordIndex` (1-based) |
| `restore_original` | 清除 `generatedFilePath`，显示原图 | `sessionId` |
| `rename_session` | 改 fileName | `sessionId`, `fileName` |
| `reorder_sessions` | 按给定顺序排列 sessions（必须是现有 id 的全排列） | `sessionIds: string[]` |
| `set_session_prompt` | 更新 `lastPrompt` 用作下次生成默认 | `sessionId`, `prompt` |
| `add_blank_session` | 用户明确要求先占一个空位时创建占位 session；生成流程默认不先调用它 | `fileName?` |

### 工作区写（risk: destructive，v1 broker 默认 allow）

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `delete_session_record` | 从 `generatedFilePaths` 移除一条记录（逻辑删除） | `sessionId`, `recordIndex` |
| `delete_session` | 整体移除一个 session（含所有记录引用） | `sessionId` |
| `merge_sessions` | 将一组 sessions 的记录并入目标，删除被合并源 | `targetSessionId`, `sourceSessionIds: string[]` |
| `delete_unreferenced_files` | 物理删除明确列出的未引用文件候选 | `candidateIds: string[]` |

`delete_unreferenced_files` 执行时重新扫描当前未引用文件并解析 `candidateId`：(1) candidate 必须仍存在于当前扫描结果；(2) 实际路径必须在项目生成目录内；(3) 当前引用计数必须为 0。任一不满足跳过该 candidate 并在结果里返回原因。模型典型用法：先 `scan_unreferenced_files`，把返回的 candidateId 列表传给 `delete_unreferenced_files`。

### 生成与文件（risk: safe-write / external-write, **preflight: true**）

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `generate_image` | 单图生成或编辑，复用现有 tuziImageApi + localImageStorage 链路 | `target: { type:"existing", sessionId } \| { type:"new", fileName? }`, `mode: "edit" \| "generate"`, `prompt`, `size?`, `referenceImageIds?` |
| `run_batch_generation` | 对一组 sessions 顺序执行生成/编辑 | `commands: ({ target:{ type:"existing", sessionId } \| { type:"new", fileName? }, mode, instruction, referenceImageIds? })[]`, `globalInstruction?` |
| `package_generated_images` | 把生成图打包到桌面（替代 fileTasks） | `fileName?`, `sessionIds?`（不传=全部）；risk=`external-write` |

**`commands[*].mode` 必填**，无默认值。批量工具不再隐含 edit/generate 判定，避免回归到"模型猜模式"的老坑。

新图生成不在 preflight 之前创建占位 session。`target.type="new"` 的 `generate_image` / `run_batch_generation` 先展示 preflight；用户确认后才在同一个 mutationSink 事务里创建新 session、生成占位图并执行 imagen API。用户取消 preflight 时不会留下空白 session。`add_blank_session` 只处理用户明确要求"先建一个空位"的纯工作区操作，不是新图生成的前置步骤。

`mode="generate"` 的语义：从文本和参考图从零生成。它可以用于 `target.type="new"`，也可以用于 `target.type="existing"` 表示忽略当前图、在该 session 下追加一条全新生成记录；不会把当前图作为 edit 输入。`mode="edit"` 只允许 `target.type="existing"`，必须使用该 session 当前图作为 edit 输入。

`generate_image` 与 imageSessionAgent 共享同一执行体（提取为共享模块）。两者的差异由 turnState 注入决定：Esse turnState 注入 `preflightSink` → 调用走预览卡片；imageSessionAgent turnState 注入 auto-execute preflight → 直接执行。共享执行体不感知差异。

### 不在 v1

`add_reference_image`（涉及文件落盘交互，留 v1.1）、`split_session`、`duplicate_session`。

## 工具 description 编写规范

description 是模型路由工具的主信号，比 system prompt 重要。每个工具必须按以下结构写：

1. **第一句**：动词开头，说清"做什么 + 作用对象"。
2. **何时用 / 何时不用**：明确正反两面。
3. **参数语义**：每个参数单独说明，1-based 等约定写进 description。
4. **典型错误**：列出 isError 的情形，让模型预期失败模式。

样板：

```ts
// list_sessions.description
"List all image sessions in the current BatchImager project. " +
"Returns id (stable token), displayLabel (rendered like 'img-1'), fileName, generatedFilePaths length, current generatedFilePath, status.\n" +
"Use this whenever you are unsure about session count, ids, or which session has which file. Call once per turn — results stay valid until you mutate.\n" +
"Do not use this to inspect a single session's records; use get_session_records instead.\n" +
"Always reference sessions by id in subsequent tool calls; displayLabel is for talking to the user only."

// restore_session_record.description
"Restore an image session's current image to a previous generated record. " +
"Pure metadata operation, does not regenerate or modify files on disk.\n" +
"Use when the user asks to roll back, revert, or switch to a previous version of a specific image.\n" +
"Do not use when the user wants to create a new image (use generate_image) or to delete a record (use delete_session_record).\n" +
"Parameters: sessionId — stable session id from list_sessions. recordIndex — 1-based index matching the UI label 记录 N; recordIndex=1 maps to generatedFilePaths[0].\n" +
"Returns isError when session not found or recordIndex is out of range (1..generatedFilePaths.length)."

// generate_image.description (Esse 版)
"Generate or edit a single image via the imagen API. Costs API credit and takes 10-60 seconds per call.\n" +
"Before execution this tool ALWAYS shows the user a preflight card; the user can confirm or cancel. If canceled, the tool returns isError with reason 'User canceled preflight'. Do NOT retry the same command on cancel without first asking the user what to adjust.\n" +
"Use mode='edit' with target.type='existing' to modify or restyle the session's current image. Use mode='generate' to create a new image from scratch; target.type='new' creates the session only after the user confirms preflight.\n" +
"Always reference sessions by id from list_sessions, never by displayLabel. referenceImageIds are ids from the project's reference image set, not file paths."
```

prompt 里 few-shot 覆盖正例，description 覆盖反例与边界。

## 工具执行架构

### 单次 turn 流程

```
renderer → esse:send-message
  → main 取该 projectDirectory 的 mutationSink 单例（SinkRegistry）
  → 构造 EsseTurnState：
       state（projectStore 当前 ProjectState 快照引用）
       projectDirectory
       signal
       mutationSink（per-project 单例）
       permissionBroker（v1 默认 allow）
       preflightSink（Esse 持有；imageSessionAgent 不持有）
       toolCallSink（每次调用推一条 chat context message）
  → turnStateByKey[registryKey] = turnState
  → runtime.prompt(text) 进入 pi tool-use 循环
       ├─ 模型按需多次调用工具
       │   - 读工具：直接读 turnState.state 返回
       │   - 写工具（safe-write / destructive）：
       │       1. domain reducer 算新 ProjectState
       │       2. broker.request() 决定（v1 直接 allow）
       │       3. mutationSink.apply(mutator)：事务性写 projectStore + 广播
       │       4. toolCallSink.record(...) 推 chat context
       │       5. 返回简短文本结果给模型
       │   - generate_image / run_batch_generation / package_generated_images：
       │       1. 校验参数
       │       2. 构造 preflight payload → preflightSink.request → 等用户确认
       │       3. 确认 → 调底层 tuziImageApi / 打包链路 → 通过 mutationSink 写回结果
       │       4. 取消 → 返回 isError "User canceled preflight"
       └─ 模型输出最终 reply（无工具调用）
  → IPC 返回 { reply }
```

### 关键不变量

- **mutationSink 是 per-projectDirectory 单例**。所有写入口（Esse 工具、imageSessionAgent 工具、用户 UI 操作的 IPC handler）共享同一 sink，串行队列对整个项目生效。
- **turnState.state 永远最新**。mutationSink.apply 完成时立即把新 state 写回 turnState.state；后续读工具看到 mutate 后的状态。
- **renderer 全程被动**。收到 `project:snapshot-updated` 就 reconcile React state；不再有 renderer → main 的私有写路径。
- **chat 是工具调用的事件流**。每次调用产出一条 `contextType: "esse-tool-call"` 消息，含工具名、关键参数、结果摘要，受影响 sessionId 列表。

### turnState 形状

```ts
interface EsseTurnState {
  projectDirectory: string;
  state: ProjectState;                  // 持完整快照，不只 sessions
  signal?: AbortSignal;
  mutationSink: ProjectMutationSink;    // per-project 单例
  permissionBroker: PermissionBroker;
  preflightSink?: PreflightSink;        // Esse 持有；imageSessionAgent 不持有
  toolCallSink: ToolCallSink;
}

interface ProjectState {
  project: ProjectMetadata;
  projectManagerState: ProjectManagerState;
  referenceImages: BatchPlanReferenceImage[];
  sessions: ImageSession[];
  selectedSessionId: string | null;
}
```

reducer 接受 `(state: ProjectState, ...args) => { state: ProjectState; result }`，全状态进出。`projectManagerState` 和 `referenceImages` 必须在 v1 纳入状态快照，因为文件引用计数、preflight 缩略图、方案报告都需要读取这些引用；不能作为"后续视需要"再补。

### 并发与串行化

pi SDK 可能在同一轮里并发触发多个工具调用。执行规则：

- **读工具：并发安全。** 直接读 turnState.state 引用，无写动作。允许并发。
- **写工具：必须串行。** mutationSink 内部维护单一 promise 链，per-project 生效：

```ts
class ProjectMutationSink {
  private chain: Promise<unknown> = Promise.resolve();

  apply(mutator: (current: ProjectState) => ProjectState): Promise<void> {
    const next = this.chain.then(async () => {
      // projectStore.applyTransaction 内部：SQLite tx 写入 + 内存替换 + commit
      // tx 失败自动回滚内存，抛错给调用方。
      const newState = await this.projectStore.applyTransaction(mutator);
      this.broadcast(newState);
      this.turnStates.forEach((ts) => { ts.state = newState; });
    });
    this.chain = next.catch(() => {});
    return next;
  }
}
```

- **写期间的读**：读工具拿到的 turnState.state 是当前最新已提交版本。如果一个写正在 apply 中（事务未提交），读看到的是旧值。这一点接受，因为强一致只能靠串行化所有调用，代价过高。
- **mutator 函数体内不允许 await 外部 IO**。mutator 是纯函数：拿当前 state，返回新 state。所有 IO（SQLite tx 提交、广播）由 mutationSink + projectStore 统一负责。
- **projectStore.applyTransaction 必须是事务性**：要么内存替换 + 落盘都成，要么都不成。SQLite tx 失败时回滚内存到 oldState，抛错给上层。这避免"内存改了但盘没写"的状态分裂。

## Permission 层（broker，v1 默认放开）

每个工具声明 `risk: "read" | "safe-write" | "destructive" | "external-write"`，v1 全局 policy 是 `allow-all`：runtime 默认 `requestPermission` 直接返回 `{ decision: "allow" }`。当前单测覆盖了 destructive / safe-write 工具会经过 broker，并且 permission 在 preflight 之前执行；deny 会阻止后续 mutation / preflight。

destructive 工具 v1 不弹卡片，不打断 agent，只通过 toolCallSink 留可观测痕迹。误操作保护改靠：

- toolCallSink 让用户事后能看到具体调用。
- `delete_session_record` 等只做逻辑删除，配 `scan_unreferenced_files` + `delete_unreferenced_files` 显式物理删除两步。
- prompt 强约束删除前必读。

收紧路径（v1.1）：把 policy 改成 `{ destructive: "ask", externalWrite: "ask" }`，broker 通过 `esse:permission-request` ↔ `esse:permission-response` IPC 弹卡片，工具代码不动。IPC 通道和 `esse-permission-request` chat 消息类型还未接 UI，这是后续收紧项，不影响 v1 默认 allow 的接口连通。

## Preflight 层（v1 永远生效，独立于 broker）

### 适用范围

仅三个工具：`generate_image` / `run_batch_generation` / `package_generated_images`。理由：调 imagen API 单次 10-60 秒、消耗 API 额度；打包写桌面文件涉及文件名/范围用户希望先确认。

### 工作流程

```
工具 execute(params):
  1. 校验参数
  2. 构造 preflight payload：
     {
       tool: "generate_image" | "run_batch_generation" | "package_generated_images",
       commands: [{ target, displayLabel?, mode, prompt, referenceImageIds, ... }],
       estimatedApiCalls: number,
       estimatedDurationSeconds?: number
     }
  3. const decision = await turnState.preflightSink.request(payload)
  4. decision === "execute" → 调底层执行链路
  5. decision === "cancel" → 返回 isError:
        Reason: User canceled preflight.
        Detail: <用户在卡片上勾选的取消理由（v1 可选）>
        Suggested next: Ask the user what to adjust before retrying; do NOT retry with the same parameters.
```

### IPC

- main → renderer: `esse:preflight-request` { requestId, payload }
- renderer 在 chat 中渲染 `contextType: "esse-preflight-request"` 卡片
- renderer → main: `esse:preflight-response` { requestId, decision: "execute" | "cancel" }

### UI 卡片内容

- 工具名称（"生成图片" / "批量生成" / "打包导出"）
- 每个 command 一行：displayLabel + 缩略图 + mode 标签（生成 / 编辑） + prompt 截断文本 + 引用图缩略图
- 估算消耗（API 调用次数）
- 按钮：执行 / 取消
- 用户做出决定后卡片定格显示结果，不可再操作。

### Esse vs imageSessionAgent 边界

- **Esse turnState 注入 preflightSink** → 调用 imagen API 工具时永远先 preflight。
- **imageSessionAgent turnState 不注入 preflightSink**（或注入 auto-execute 实现） → 单图 chat 中的 generate_image 直接执行。理由：用户已选中具体图、给出明确指令，preflight 体验碎。

### 与 broker 的关系

完全独立。broker 关心 risk（destructive 需 ask），preflight 关心 cost（imagen API 工具永远确认）。两个判定串行执行：先 broker，再 preflight。v1 broker 默认 allow 不打断，所以实际只有 preflight 生效。

## 多轮 tool-use 循环

agentRuntime + pi SDK 已支持。本计划要做的改动：

- `runEsseAgentTurn` 不再 `parseEsseResponse` 整段 JSON。最终 reply 直接 `runtime.getLastAssistantText()`。
- `customToolDefinitions: []` → 注册上述完整工具集。
- `EsseAgentTurnResult` 简化为 `{ reply: string }`。`fileTasks` / `imageRequests` / `plan` 字段从响应类型移除（renderer 端这部分代码同步删除）。
- 旧 `runEssePlanTurn`（项目初创批量生成入口）删除；批量生成类意图统一走 Esse workspace turn 的 `run_batch_generation` 工具和 preflight 卡片。

## Turn 边界与错误协议

### 迭代上限

- **每 turn 最多 30 次工具调用**。第 31 次拒绝执行，工具返回 isError，模型主动收尾。
- **每 turn 最多 10 次写工具调用**（不含读工具，不含 generate_image / run_batch_generation 这些被 preflight 隔开的工具）。
- **执行超时 5 分钟**：只统计模型推理与工具执行时间，不统计 preflight 等待时间。通过 signal.abort 触发，进行中的 mutationSink.apply 等当前事务完成，后续不再调度。
- **preflight 等待超时 10 分钟**：用户长时间不响应时 preflightSink.request 自动 resolve 为 cancel，工具返回 isError "Preflight timed out"。
- **批量生成总超时**：`run_batch_generation` 的执行超时按 `max(5 分钟, estimatedApiCalls * 90 秒)` 计算，preflight 确认后开始计时。

### 取消语义

用户按"停止"或前端断连 → signal.abort：

- 工具调用尚未开始 → 直接抛 "操作已停止"。
- 工具已进入 mutationSink.apply → 等当前事务原子段跑完再传播 abort。
- 工具在 preflight 等待中 → 立即取消 preflight，返回 isError "Operation aborted"。
- 工具调用底层 imagen API 中 → 通过 signal 透传给 tuziImageApi（若 API 支持取消），不支持时等返回。

### 错误返回 schema

所有 isError 必须遵循同一形态：

```ts
{
  isError: true,
  content: [{ type: "text", text:
    `Reason: <one line>\n` +
    `Detail: <optional context>\n` +
    `Suggested next: <optional actionable hint>`
  }]
}
```

示例：

- recordIndex 越界 → `Reason: recordIndex out of range. Detail: img-2 has 2 records, requested 3. Suggested next: call get_session_records to verify.`
- session 不存在 → `Reason: session not found. Detail: no session with id sess_abc123. Suggested next: call list_sessions to list current ids.`
- 迭代上限 → `Reason: Tool call limit reached for this turn. Suggested next: Summarize what you have done and return a final reply.`
- 持久化失败 → `Reason: Failed to persist project. Detail: <底层错误>. Suggested next: Report this to the user; do not retry.`
- preflight 取消 → 见上节"工作流程"第 5 步。

不允许出现裸 `"invalid input"` / `"error"` 无信息错误。

## Session ID 稳定性（前置约束）

当前 [src/domain/imageSessions.ts:5](src/domain/imageSessions.ts:5) 用 `id: img-${index + 1}`，session id 是数组下标的派生值。引入 `reorder_sessions` / `delete_session` / `merge_sessions` 后 id 会随位置漂移，破坏"先看后写"的 agent 工作流。

**强制改动**：

- session.id 直接改成稳定不可变 token。格式：`sess_<20 hex/random chars>`，生成时机：`createImageSessions` / `appendImageSessions` / `add_blank_session`。一旦生成终身不变。
- **不引入 stableId / displayLabel 双字段**。session.id 就是稳定 token；UI 渲染时根据当前位置算出 `displayLabel`（"img-1"、"img-2"），仅用于渲染和与用户对话，不进数据模型、不进 IPC、不传给工具。
- list_sessions 返回里同时给 `id` 和 `displayLabel`：模型对外说 "img-1" 用 displayLabel，调工具时必须用 id。
- 项目快照里持久化的也是稳定 id。旧项目打开时一次性 migrate：按当前 sessions 顺序补发稳定 id 写回，幂等。迁移时必须用 oldId → newId map 同步重写 `selectedSessionId`、projectManagerState 中的 `targetSessionId` / `sourceSessionId` / `targetSessionIds` / reports.targetSessionId 等所有仍会保留的 session 引用字段。

这条改动必须在所有工具开发之前完成（实施步骤 0）。

## Esse Prompt 改造

`buildFullEssePrompt` 重写工具说明部分。删除 imageRequests / plan / fileTasks 的字段规约，改成工具清单 + 路由规则：

```text
你是 Esse，一个能用工具操作 BatchImager 项目的设计师 agent。
所有副作用必须通过工具执行；不要在 reply 里假装已经完成。

工作区工具：
- 读：list_sessions / get_session_records / get_project_overview / read_image_metadata / scan_unreferenced_files
- 写：restore_session_record / restore_original / rename_session / reorder_sessions / set_session_prompt / add_blank_session
- 销毁：delete_session_record / delete_session / merge_sessions / delete_unreferenced_files

生成与文件工具（每次调用都会先弹预览卡片让用户确认）：
- generate_image / run_batch_generation / package_generated_images

工作流：
1. 不确定状态时，先调读工具。list_sessions 一次足够，turn 内有效。
2. 工具参数里的 sessionId 必须使用 list_sessions 返回的 id（稳定 token），不要用 "img-1" 这种 displayLabel。
3. "img1-4" 表示 img-1 到 img-4，展开成多次工具调用，每个 sessionId 独立。
4. 删除前先 list/get 校验 recordIndex。
5. 物理删除文件必须两步：先 scan_unreferenced_files 拿候选清单，再 delete_unreferenced_files 传入明确 candidateId；不要传 filePath。
6. 调 generate_image / run_batch_generation / package_generated_images 时用户会看到预览卡片；如果用户取消，不要原样重试，先问用户要调整什么。
7. run_batch_generation 的 commands 每条必须显式指定 mode："edit" 或 "generate"，没有默认值；新图用 target.type="new"，不要先 add_blank_session。
8. 完成后用一句中文 reply 总结你做了什么，不要重复工具结果。
```

附三个 few-shot example：

1. "img-2 现在有几张生成图？" → `get_session_records` → reply。
2. "回退 img1-4 到记录 1，删除记录 2" → 一次 `list_sessions` → 每个 session id 各调一次 `restore_session_record` + `delete_session_record` → reply。
3. "把 img-3、img-4 改成手持的姿势" → `list_sessions` → `run_batch_generation`（两条 mode=edit 的 command）→ （用户在预览卡片点执行）→ reply。

## UI 改造

### Chat 内嵌工具调用流

每次工具调用产出 `contextType: "esse-tool-call"` 消息：

- header：工具中文 label（列出工作区 / 回退记录 / 删除记录 / 生成图 / 批量生成…）
- 参数摘要：sessionId 对应的 displayLabel、recordIndex、prompt 截断到一行
- 结果摘要：成功/失败 + 一句话
- 失败时附 Reason / Detail / Suggested next

formate 复用现有 `batch-prompt` context message 风格。

### Preflight 卡片

`contextType: "esse-preflight-request"` 消息（详见 Preflight 层章节）。卡片是 chat 内联的非阻塞元素，但 Esse 当前 turn 会等待用户操作或超时。用户做出决定后卡片定格为结果状态。

### Permission 卡片占位（v1 不渲染，类型先定义）

`contextType: "esse-permission-request"` 在 v1 不会被产出，但消息类型、渲染分支留空骨架。后续 broker policy 切 ask 时不用动 chat 渲染框架。

### 工作区被动 reconcile

renderer 监听 `project:snapshot-updated`：

- main 在每次 mutationSink.apply 完成、imageSessionAgent 生成完成、用户 UI 操作（IPC handler 触发 sink）后都广播该事件。
- renderer 用 diff 替换 React state，左侧工作区列表、缩略图、当前图全部自动同步。
- 删除已有的"renderer 端 persistProjectSnapshot"调用路径——所有 persist 都在 main，renderer 只是订阅者。

### 删除后的 chat message 占位

reducer 同步把指向被删记录的 `chatMessages[*].generatedFilePath` 清空。MessageActions 检测到该字段为空但消息原本是生成型时，渲染"记录已删除"占位（灰色卡片，不可点开），避免 404 缩略图。

## 数据流与一致性

写工具调用 `mutationSink.apply(mutator)` 的内部顺序：

1. `projectStore.applyTransaction(mutator)` 开 SQLite tx。
2. mutator 算新 ProjectState（纯函数）。
3. SQLite 写入新 state，commit。
4. commit 成功 → projectStore 内存替换为新 state，返回新 state。
5. mutationSink 拿到新 state → `webContents.send("project:snapshot-updated", snapshot)`。
6. 所有 turnState.state 引用更新为新 state。
7. 工具返回结果给模型。

任意一步失败（mutator 抛错 / SQLite 失败）→ tx 自动回滚 → projectStore 内存不变 → 抛错给工具层 → 工具返回 isError → turnState.state 保持原值 → 模型可重试或放弃。

renderer 写入路径全部改成 IPC 调 main 的写处理函数（如"用户手动选图"调 `workspace:restore-record` IPC handler），handler 内部通过同一个 mutationSink 单例写。renderer 也接收同一个 snapshot 推送做 reconcile。

## 文件删除与引用计数

`delete_session_record` / `delete_session` / `merge_sessions` 只做逻辑删除——移除引用，不动物理文件。

物理删除走两步工具：

1. **scan_unreferenced_files**（只读）：扫描下述引用源，计算项目生成图目录下的引用计数，返回引用计数为 0 的文件候选 `{ candidateId, fileName, byteSize, lastReferencedBy? }[]`。引用源：
   - 所有 session 的 `filePath`、`generatedFilePath`、`generatedFilePaths`。
   - 所有 chat message 的 `generatedFilePath`、`referenceFilePaths`、`sourceFilePath`。
   - project manager reports 的 `generatedImagePath`。
2. **delete_unreferenced_files(candidateIds)**（destructive）：接受 candidateId 列表，执行时重新扫描并做防御性检查（candidate 仍存在 + 实际路径在项目生成目录内 + 当前引用计数为 0），通过的才物理删除。不通过的在结果里返回原因。

这套设计让模型不可能因传错路径删错文件——模型只持有 candidateId，看不到也传不了真实路径；main 每次删除前重新解析 candidateId 到当前扫描结果。

## Domain Reducer

新增 `src/domain/projectMutations.ts`，全部纯函数，独立测试。签名统一为：

```ts
type Reducer<P> = (state: ProjectState, params: P) => {
  state: ProjectState;
  result: ReducerResult;
};

type ReducerResult =
  | { ok: true; summary: string; affectedSessionIds: string[] }
  | { ok: false; reason: string; detail?: string; suggestedNext?: string };
```

涵盖：

```
applyRestoreRecord / applyRestoreOriginal
applyRenameSession / applyReorderSessions / applySetSessionPrompt
applyAddBlankSession
applyDeleteRecord / applyDeleteSession / applyMergeSessions
applyAppendGeneratedRecord    // 给 generate_image 完成后写回结果用
applyReplaceCurrentImage      // 给 generate_image mode=edit 完成后写回用
```

`applyDeleteRecord` 的 fallback：删除当前图时切到被删记录前一条；唯一记录被删 → 清空当前图，`showOriginalInList = true`；同步清空 chat message 中指向被删 path 的 `generatedFilePath` 字段。

reducer 找不到 / 越界等情形返回 `result.ok: false`，state 不变。

## 测试计划

### Domain（纯函数）

每个 reducer 至少覆盖：成功路径、参数越界、session 不存在、当前图被删的 fallback、chat message 同步、merge 时记录顺序保持、appendGeneratedRecord 与 replaceCurrentImage 的状态切换。

### mutationSink

- 串行性：并发触发多个 apply，按调用顺序串行执行。
- 事务回滚：projectStore.applyTransaction 抛错时 turnState.state 不变。
- per-project 单例：两个不同 projectDirectory 的 sink 不互相串行；同 projectDirectory 但不同入口（Esse / imageSessionAgent / UI IPC）走同一队列。
- broadcast：成功后必发 `project:snapshot-updated`，失败时不发。

### 工具层（mock turnState）

- 读工具返回结构正确，含 displayLabel 字段。
- 读工具不把本地 filePath 暴露给 LLM；记录工具只返回 `recordIndex` / `fileName` / `isCurrent`。
- 写工具调 reducer + mutationSink 一次。
- destructive / safe-write / external-write 工具 v1 直接 allow，但 broker.request 会在 mutation 或 preflight 前被调用一次（验证接口连通）。
- imagen API 工具走 preflightSink.request，cancel 时返回带 "do not retry" 提示的 isError。
- read_image_metadata 拒绝任何非法 sessionId 入参，不接受 filePath。
- delete_unreferenced_files 防御性检查：未知 candidateId / 仍被引用的 candidate / 解析后不在项目生成目录内的 candidate 都被跳过。
- 同 turn 内连续两次写工具，第二次能看到第一次的结果。

### Esse turn 集成（stub pi SDK）

构造 deterministic 工具调用序列：

- "img-2 有几张生成图" → 模型先 get_session_records 再 reply。
- "回退 img1-4 到记录 1，删除记录 2" → 至少 8 次写工具调用，最终 reply 非空，全程无 preflight。
- "把 img-3、img-4 改成手持姿势" → list_sessions + run_batch_generation（一次 preflight 包含两条 command）→ stub preflight 返回 execute → 两次 imagen API → reply。
- preflight cancel 路径：上面同样的输入，stub preflight 返回 cancel → 模型收到 isError → reply 反映"已取消，请明确要调整什么"。
- 全程不出现 imageRequests / plan / fileTasks 字段。

### IPC

- `project:snapshot-updated` 推送后 renderer state 重建正确（含被删 chat message 占位）。
- `esse:preflight-request` ↔ `esse:preflight-response` 往返契约，requestId 匹配。
- preflight 超时（10 分钟）行为正确：sink resolve 为 cancel。
- 用户 UI 操作 IPC handler 走同一 mutationSink，与工具操作同一路径。
- runtime invalidate 时 turnStateByKey 条目一并清除；mutationSink 不随 turn 清除（单例 per-project）。

## 实施步骤

按垂直切片推进。每个切片都必须包含 reducer / 工具 / main 落盘 / renderer reconcile / eval；不能先堆一批 prompt 或 UI 再回头补执行能力。最终删除旧路径时再做一次性收口，避免长期双入口。

0. **Session 稳定 id migration**：[src/domain/imageSessions.ts](src/domain/imageSessions.ts) 改用 nanoid 生成 session.id；displayLabel 仅在渲染层（SessionPanel 等）按位置算出；旧项目快照打开时一次性 migrate 写回稳定 id，幂等。所有现存读 `session.id` 的代码梳理一遍区分 "稳定 id" vs "用户面渲染序号"。
1. **工作区记录切片**：`list_sessions` / `get_session_records` / `restore_session_record` / `delete_session_record` / `delete_session` / `merge_sessions` 先落地。要求能完成"删左侧第二张图"这类任务，并通过离线 eval 与 stub runtime 集成测试。
2. **ProjectState + reducer 全集 + 测试**：建 [src/domain/projectMutations.ts](src/domain/projectMutations.ts)，纯函数。工作区工具先复用同一套 reducer 语义，Electron 层只做持久化适配。
3. **projectStore.applyTransaction + ProjectMutationSink**：SQLite 事务语义；per-project 单例注册到 SinkRegistry；`esse:send-message` 与 `project:save-snapshot` 至少走同一 sink，后续把所有 renderer 写入口逐步迁到 IPC handler。
4. **renderer snapshot reconcile**：preload 暴露 `subscribeProjectSnapshotUpdates`，App 收到 `project:snapshot-updated` 后统一 `applyProjectSnapshot`。Esse 工具写入成功后左侧工作区必须自动更新。
5. **turnState 注入框架**：mutationSink / permissionBroker（默认 allow）/ preflightSink / toolCallSink 在 `runEsseAgentTurn` 起手处构造；imageSessionAgent 同步迁移（不注入 preflightSink）。
6. **工具集扩展**：补齐 rename/reorder/restore_original/set_prompt/add_blank/read metadata/scan unreferenced/delete unreferenced。
7. **生成与文件工具**：`generate_image` / `run_batch_generation` / `package_generated_images` 迁到 custom tools；`generate_image` 抽取为共享模块，Esse 与 imageSessionAgent 共用执行体。
8. **Preflight IPC + UI 卡片**：`esse:preflight-request` ↔ `esse:preflight-response` 通道，`esse-preflight-request` chat 消息渲染。
9. **Esse prompt 重写 + few-shot example**：删除 JSON 字段规约，改成工具清单 + 路由规则。
10. **runEsseAgentTurn 简化**：删除 parseEsseResponse / normalizeEsseResponse 的 imageRequests/plan/fileTasks 分支，最终结果只取 reply。
11. **响应类型与 IPC 类型清理**：`SendEsseMessageResponse` 只剩 `reply`；renderer 端 ProjectPlanPanel / SessionPanel 相关分支删除。
12. **Chat 工具调用流 UI**：`esse-tool-call` context message 渲染。
13. **被删记录的 chat message 占位 UI**：已在 `SessionPanel` 适配；生成型消息的路径被清空后显示不可点击占位。
14. **runEssePlanTurn 入口适配**：旧入口删除；项目初创/批量生成类意图统一走 workspace 工具循环。
15. **删除 imageRequests / plan / fileTasks 旧代码**：旧 service 文件、旧测试、旧 IPC 字段已清掉；renderer 内部仍保留 `EsseImageRequest` 作为执行现有 `BatchPlan` 新图命令的局部任务形状，不再作为 Esse IPC 响应。

硬约束：从第 7 步开始迁生成工具后，第 15 步必须同 PR 收口；不要留长期的 `imageRequests` / 工具双生成路径。

## 风险与权衡

- **token 膨胀。** 多轮工具调用比单次 JSON 响应消耗 token 多。对策：(1) 工具结果只回短摘要，长信息靠下次工具读；(2) prompt 写明 "list_sessions 一次足够"；(3) 监控生产 turn 平均工具调用次数，超阈值再优化。
- **Broker 默认放开偏离主流最佳实践。** Claude Code 默认要求显式确认，Codex approval mode 默认不是 full-auto。我们 v1 直接选 full-auto 等价档，是为了让 Esse 跑通体验后再收紧——产品判断，非工程默认。缓解：(1) toolCallSink 事后可见；(2) 物理删除拆 scan + delete 两步且 delete 必须显式传路径；(3) v1.1 把 policy 改 ask 即可加弹窗，工具代码不动。决定保留时在产品文案告知用户"Esse 默认有逻辑删除权限"。
- **Imagen API 工具走 preflight 而不走 broker。** 故意区分：preflight 关心成本与等待代价（永远生效），broker 关心数据安全（v1 放开）。即使 v1.1 broker 切 ask，imagen 工具的 preflight 也不会被替代——两者并存，因为用户对"花钱花时间"和"误删数据"的容忍度不同。这条要在 UX 文档里说明，避免后续团队把 preflight 当成 "broker 的某种皮肤" 而合并掉。
- **Preflight 等待会占用 turn 时间。** 用户长时间不响应卡片，turn 一直挂着。对策：10 分钟超时强制 cancel；UI 上显式标注"等待用户确认"状态，让 Esse 行为可解释。
- **模型在 preflight cancel 后原样重试。** 这是 LLM 常见失败模式。对策：在工具 description 和 cancel 错误信息里同时写明 "do not retry without changes; ask user what to adjust"；few-shot 加一个 cancel 后 reply 的样例。
- **mutationSink per-project 单例的爆炸半径。** 现有 renderer 写入口全部要改 IPC handler。一次性切换的代价是 PR 大，但优于双入口期间的 race。
- **撤销缺失。** v1 不做 undo。靠 toolCallSink 可观测性 + 删除全部逻辑化 + 物理删除两步 + imagen 工具 preflight 四层网做事前/事后保护。完整 undo（撤销最后 N 个工具调用）作为 v1.2 议题；toolCallSink 日志本身就是 undo 日志的天然原料。
- **imageSessionAgent 与 Esse 共用 generate_image 执行体的隔离。** 共享执行体不感知 preflight 差异，只看 turnState.preflightSink 是否注入。注意 turnState 类型在两边可能有别字段，需要 narrow 处理。

## 后续扩展（不在 v1）

- `add_reference_image`、`split_session`、`duplicate_session`。
- broker policy = ask：destructive 弹卡片，per-session allow-list。
- undo 工具：基于 toolCallSink 日志回滚最后 N 个写操作。
- preflight v2：支持 "modify" 决策让用户在卡片上微调 prompt 后再执行。
- agent 横向扩展：让 Esse 跨项目（list_projects / switch_project）。
