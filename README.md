# BatchImager

BatchImager 是一个 macOS / Windows Electron 工作区，用于批量把仓库图、现场图生成成电商可用的商品图。用户导入图片后，可以让右侧 agent provider 批处理、优化、回退、打包和继续细修单张图片；当前默认 provider 是 Esse。

## Agent Skills

BatchImager 接入了 Agent Skills 标准和 pi 的 Skills 加载能力。应用启动时会把内置 skills 同步到本机用户目录，并在设置面板的 `Skills` 页显示可用项、启用状态、诊断信息和 `SKILL.md` 内容。

当前内置三个制品导出 skills：

- `xlsx-export`：把当前项目生成图元数据导出为 Excel 清单。
- `pdf-portfolio`：把生成图排版成 PDF 作品集。
- `project-package`：把图片、manifest 和 Excel 清单打包成交付 zip。

用户也可以在设置面板添加额外搜索目录，或从 Git URL 安装标准 `SKILL.md` 仓库。技能执行通过受控 `bash` 工具运行，会经过命令策略、权限确认和环境变量净化。当前设计入口见 [docs/README.md](docs/README.md)。
