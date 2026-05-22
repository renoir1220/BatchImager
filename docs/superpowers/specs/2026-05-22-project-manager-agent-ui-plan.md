# 项目经理 Agent 与图片会话协作计划

## 背景

BatchImager 现在的核心交互是“每张图片一个独立会话”。这个设计应该保留，因为它让不同图片可以并行执行不同任务：A 图可以做白底图，B 图可以做家居场景，C 图可以做详情页氛围图，互不污染上下文。

引入 Pi 之后，产品需要新增一层项目级智能体。它不是替代图片会话，而是像工厂里的经理：理解整批图片的目标，制定方案，把任务分发给每个图片会话，再汇总执行状态。

## 产品模型

### 项目经理

项目经理负责项目级理解和调度：

- 理解用户对整批图片的目标。
- 形成项目级方案，例如风格、尺寸、平台、统一约束。
- 把批处理要求拆成多张图片的具体任务。
- 给图片会话下发结构化指令。
- 汇总每张图片的执行结果、失败原因和重试建议。
- 维护项目级上下文，例如 pin 参考图、全局风格、长期偏好。

### 图片会话

图片会话是“工人”，不一定需要是 subagent。第一阶段它可以只是带 tool call 能力的可执行会话：

- 绑定单张图片。
- 保存这张图的 prompt 历史、生成版本、参考图和失败状态。
- 接收用户直接指令。
- 接收项目经理下发的任务。
- 调用现有 `generate_image` 工具完成单图生成。
- 生成 `WorkerReport` 回报给项目经理。

这种设计不限制未来发展。之后如果某些图片会话需要自主重试、质检、读取项目文件或多轮优化，可以把 `ImageSession` 的执行器替换成真正的 `ImageWorkerAgent`。

## 数据结构

```ts
interface ProjectManagerConversation {
  id: string;
  messages: ProjectManagerMessage[];
  currentPlanId?: string;
}

interface BatchPlan {
  id: string;
  title: string;
  globalInstruction: string;
  outputSize?: string;
  targetSessionIds: string[];
  commands: WorkerCommand[];
  status: "draft" | "running" | "completed" | "failed" | "paused";
}

interface WorkerCommand {
  id: string;
  planId: string;
  targetSessionId: string;
  instruction: string;
  outputSize?: string;
  referenceImageIds?: string[];
  constraints: string[];
  source: "project-manager";
}

interface WorkerReport {
  commandId: string;
  targetSessionId: string;
  status: "completed" | "failed" | "skipped";
  generatedImagePath?: string;
  summary: string;
  errorMessage?: string;
}
```

## 执行流程

```text
用户对项目经理提出批处理要求
  -> 项目经理理解目标
  -> 生成 BatchPlan
  -> UI 展示方案卡片，用户确认或调整
  -> 系统把 BatchPlan 拆成 WorkerCommand
  -> 每个图片会话收到“来自项目方案”的任务消息
  -> 图片会话调用 generate_image
  -> 图片会话生成 WorkerReport
  -> 项目经理汇总项目状态
```

第一阶段可以不自动执行。先让经理生成方案并展示，用户点击“开始执行”后再下发到各图片会话。

## 上下文策略

项目级上下文和图片级上下文必须分层：

- `ProjectMemory` 保存项目目标、全局风格、pin 参考图、当前批任务和用户长期偏好。
- `ImageSessionMemory` 保存单图历史、当前版本、局部 prompt 和局部参考图。
- `BatchJobMemory` 保存一次批量任务的 plan、分发状态、结果和失败重试信息。

每轮 agent 调用不应该塞入所有历史。系统应先判断作用域，再组装本轮上下文：

```text
用户输入
  -> 判断作用域：项目 / 批任务 / 当前图片 / 多选图片
  -> 检索相关上下文
  -> 组装 AgentWorkingContext
  -> 执行工具
  -> 写回 ProjectMemory / BatchJobMemory / ImageSessionMemory
```

## 侧边栏显示原则

当前产品只有一个右侧会话栏。新增项目经理后，右侧栏继续保持单一位置，但顶部改为两个清晰 tab：

- `项目方案`：项目经理会话，负责整体方案、批处理拆解和多图调度。
- `当前图片`：图片会话，负责当前选中图片的局部生成和修改。

这里的 tab 不是工程师工具里的 “Agent / Composer / Chat” 类型，而是面向图片生产工作流的两个自然对象。用户不需要理解 agent 概念，只需要理解：

- 我在 `项目方案` 里讨论整批图怎么做。
- 我在 `当前图片` 里处理这一张图怎么改。

## 界面概要：双 Tab 侧边栏

右侧栏顶部固定为两个 tab。视觉上使用紧凑 segmented control，而不是浏览器式标签页：

```text
┌──────────────────────────────┐
│  项目方案   当前图片          │
│──────────────────────────────│
│  项目方案 / 当前图片内容区域  │
└──────────────────────────────┘
```

### 项目方案 Tab

`项目方案` 是经理视图。它包含：

- 项目级对话流。
- 当前项目目标摘要。
- pin 参考图和全局约束摘要。
- `BatchPlan` 方案卡片。
- 批任务状态：草稿、执行中、完成、失败、暂停。
- 对多张图片的指挥动作，例如“开始执行”“修改方案”“重试失败项”“下发到选中图片”。

经理视图里的 `BatchPlan` 卡片显示：

```text
批量方案：家居暖色鲜花商品图
全局要求：保留花材颜色和形状，统一暖色调
输出尺寸：3840x2160

img-1 白底主图
img-2 白底主图
img-3 客厅茶几场景
img-4 卧室床头柜场景

[修改方案] [开始执行]
```

### 当前图片 Tab

`当前图片` 是工人视图。它继续沿用现在的图片会话体验：

- 顶部显示当前图片文件名。
- 显示当前图片缩略图。
- 显示该图片自己的聊天记录、生成记录和失败状态。
- 用户可以直接对当前图说“这张再自然一点”。
- 如果任务来自经理，会插入上下文消息：

```text
来自项目方案：
生成客厅茶几场景鲜花商品图，统一暖色调，输出 4K 横图。
```

### Tab 状态提示

两个 tab 可以带轻量状态提示，但不显示复杂 badge：

- `项目方案` 旁边可显示一个小点，表示有正在运行的批任务。
- `当前图片` 旁边可显示当前图片生成状态的小圆点。
- 失败状态只用低饱和警告色，不抢主画布注意力。

## 方案 A：基础双 Tab

优点：

- 变化小，保留当前布局。
- 用户容易理解。
- 适合第一阶段实现。
- 比下拉对象选择更直接。

风险：

- 如果 tab 文案或状态设计不好，可能变得像普通设置面板，需要通过 `批量处理` 入口和方案卡片强化“项目方案”的生产含义。

## 方案 B：双 Tab + 经理方案卡片

在基础双 tab 上，`项目方案` tab 中重点展示 `BatchPlan` 卡片。卡片显示全局目标、每张图的任务、状态和执行按钮。

优点：

- 很适合“批量处理进化成经理”的产品叙事。
- 用户可以先看方案，再执行。
- 失败、重试、跳转到单图会话都自然。

风险：

- UI 复杂度略高于方案 A。

## 方案 C：双 Tab + 任务状态联动

在基础双 tab 上，增强两个 tab 之间的联动。经理下发任务后，`当前图片` tab 自动显示对应的“来自项目方案”消息；图片完成后，`项目方案` tab 自动更新该图片的 `WorkerReport`。

优点：

- 经理和工人的关系最清晰。
- 用户能从方案跳到某张图，也能从某张图回到整体方案。
- 更接近未来完整智能体工作流。

风险：

- 需要更完整的数据结构支持，适合第二阶段。

## 推荐

第一版采用 **方案 B：双 Tab + 经理方案卡片**：

- 单侧边栏保留。
- 顶部固定两个 tab：`项目方案` / `当前图片`。
- 默认点图片时停留或切到 `当前图片`。
- 点击 `批量处理` 或项目级入口时切到 `项目方案`。
- 项目经理生成 `BatchPlan` 卡片。
- 用户确认后，卡片下发 `WorkerCommand` 到每张图片会话。
- 图片会话中插入一条上下文消息：“来自项目方案：……”
- 图片完成后回写 `WorkerReport`，经理会话显示汇总。

这样可以让 BatchImager 从“一个 prompt 广播给所有图片”进化成：

```text
一个意图
  -> 经理理解和拆解
  -> 每张图收到不同但一致的任务
  -> 并行执行
  -> 汇总反馈
```

## 分阶段实施

### 阶段 1：数据和展示

- 增加 `ProjectManagerConversation`、`BatchPlan`、`WorkerCommand`、`WorkerReport` 类型。
- 项目快照支持保存项目经理会话和计划。
- 右侧栏顶部支持 `项目方案` 与 `当前图片` 两个 tab。
- 先展示手动/模拟的 BatchPlan，不自动执行。

### 阶段 2：Pi 经理会话

- 项目经理由 Pi runtime 驱动。
- 经理可以读取项目上下文、图片列表、pin 参考图和用户批处理要求。
- 经理输出结构化 `BatchPlan`。
- UI 展示方案卡片，用户可确认、取消或让经理修改。

### 阶段 3：下发到图片会话

- `BatchPlan` 拆成 `WorkerCommand`。
- 每张图片会话收到来自项目经理的上下文消息。
- 复用现有 `runImageToolChat` / `generate_image` 执行单图任务。
- 多张图片并行执行，不阻塞整个工作区。

### 阶段 4：回报和总结

- 图片会话生成 `WorkerReport`。
- 项目经理汇总完成、失败、跳过和需要复查的图片。
- 用户可以对经理说“把失败的重试一下”“让后四张风格更统一”。

### 阶段 5：工人可升级

- 保持 `WorkerExecutor` 接口稳定。
- 第一版工人是可执行图片会话。
- 未来可替换为 Pi image worker subagent，而不改变经理和 UI。

## 设计底线

- 不取消图片级独立上下文。
- 不把项目级上下文变成无限聊天记录。
- tab 只表达生产工作对象：`项目方案` 和 `当前图片`，不出现工程师化的 Agent / Composer / Tool 命名。
- 不让经理直接绕过图片生成主流程。
- 不把图片工人过早做成复杂 subagent。
- 不阻塞多图并行生成。
