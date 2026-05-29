export type BatchImagerWorkbenchCapabilityId =
  | "get_project_overview"
  | "list_sessions"
  | "get_session_records"
  | "read_image_metadata"
  | "list_reference_images"
  | "list_remembered_preferences"
  | "scan_unreferenced_files";

export type BatchImagerWorkbenchCapabilityPhase =
  | "first-controlled-extension"
  | "later";

export interface BatchImagerWorkbenchCapabilityDescriptor {
  description: string;
  id: BatchImagerWorkbenchCapabilityId;
  owner: "BatchImager";
  phase: BatchImagerWorkbenchCapabilityPhase;
  productBoundary: string;
}

const FIRST_CONTROLLED_EXTENSION_CAPABILITIES: BatchImagerWorkbenchCapabilityDescriptor[] = [
  {
    description: "读取当前项目名称、目录、图片数量和选中 session。",
    id: "get_project_overview",
    owner: "BatchImager",
    phase: "first-controlled-extension",
    productBoundary: "项目状态来自 BatchImager，不让 agent 从目录结构猜。"
  },
  {
    description: "列出工作区图片 session、displayLabel、referenceImageId 和生成记录数。",
    id: "list_sessions",
    owner: "BatchImager",
    phase: "first-controlled-extension",
    productBoundary: "session 是产品对象，不是文件列表。"
  },
  {
    description: "读取某个 session 的生成记录和 recordIndex。",
    id: "get_session_records",
    owner: "BatchImager",
    phase: "first-controlled-extension",
    productBoundary: "生成历史是产品状态，不让 agent 直接读 sqlite 或猜文件名。"
  },
  {
    description: "按 session/record 读取图片宽高、格式和字节数。",
    id: "read_image_metadata",
    owner: "BatchImager",
    phase: "first-controlled-extension",
    productBoundary: "按产品对象定位图片，并避免暴露不必要的文件路径。"
  },
  {
    description: "列出项目参考图、本轮附件和历史候选引用。",
    id: "list_reference_images",
    owner: "BatchImager",
    phase: "first-controlled-extension",
    productBoundary: "引用集合包含临时 turn context，不是目录扫描能表达的状态。"
  },
  {
    description: "列出 Esse/agent 已记忆的用户偏好。",
    id: "list_remembered_preferences",
    owner: "BatchImager",
    phase: "first-controlled-extension",
    productBoundary: "记忆由工作台管理，不向 agent 暴露存储文件细节。"
  },
  {
    description: "扫描生成目录中没有被 session、chat 或报告引用的文件。",
    id: "scan_unreferenced_files",
    owner: "BatchImager",
    phase: "first-controlled-extension",
    productBoundary: "是否未引用需要交叉比对产品状态和磁盘文件。"
  }
];

export function listBatchImagerWorkbenchCapabilities(): BatchImagerWorkbenchCapabilityDescriptor[] {
  return FIRST_CONTROLLED_EXTENSION_CAPABILITIES.map((capability) => ({ ...capability }));
}

export function isFirstControlledExtensionCapability(id: string): id is BatchImagerWorkbenchCapabilityId {
  return FIRST_CONTROLLED_EXTENSION_CAPABILITIES.some((capability) => capability.id === id);
}
