# 项目方案剩余计划

> 代码是已完成功能的唯一准确信息来源。这个文档只保留尚未完成、仍需要产品和工程决策的后续事项。

## 已落地，不再用文档追踪

- 本地项目、项目列表、缩略图缓存。
- 图片级右侧会话和 `generate_image` 工具调用。
- Pi runtime 基础接入。
- `项目方案 / 当前图片` 双 tab。
- 批量处理生成 `BatchPlan`，用户确认后下发 `WorkerCommand`。
- 图片会话执行后回写 `WorkerReport`。
- 失败方案支持只重试失败项。

## 仍未完成

### 1. 项目级完成总结

当一个 `BatchPlan` 完成或失败后，项目方案会话应追加一条短总结：

- 完成数量、失败数量、跳过数量。
- 失败项的简短原因。
- 下一步建议，例如“重试失败项”或“调整整体风格后重新生成”。

这条总结应由纯状态变化触发，不依赖用户再发消息。

### 2. WorkerExecutor 边界

当前代码已经把“全量执行 / 失败重试”的命令选择放到 `src/domain/projectPlanExecution.ts`。下一步如果要升级图片工人为 Pi subagent，需要继续把异步执行边界从 `src/App.tsx` 收敛出来：

- 保留 `WorkerCommand -> WorkerReport` 的稳定接口。
- 现阶段 executor 继续复用现有图片会话和 `generate_image` 主流程。
- 未来替换为 Pi image worker 时，不改变 `BatchPlan`、`WorkerCommand`、`WorkerReport` 数据结构。

### 3. 上下文收敛

项目方案会话继续增长后，需要限制每轮传给模型的上下文：

- 只带最近相关的项目方案消息。
- 图片级历史只传目标图片必要摘要。
- 参考图只传本轮明确提到或方案引用的文件路径。
