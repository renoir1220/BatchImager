---
name: project-package
description: 把当前 BatchImager 项目的生成图片、manifest.json 和 Excel 清单打包成 zip 交付包。当用户说“打包交付”“发给客户”“导出项目包”时使用。
---

# project-package

内置 skill。请不要直接修改本目录；如果需要自定义，请复制到全局 skills 目录后再改。

## Setup

首次使用前运行：

```bash
cd "$BATCHIMAGER_SKILL_DIR/../xlsx-export" && npm install --omit=dev
cd "$BATCHIMAGER_SKILL_DIR" && npm install --omit=dev
```

## Usage

```bash
node "$BATCHIMAGER_SKILL_DIR/scripts/package.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/batchimager-delivery.zip"
```

只打包指定 session：

```bash
node "$BATCHIMAGER_SKILL_DIR/scripts/package.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --sessions sess_a,sess_b \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/subset-delivery.zip"
```

成功时 stdout 会输出 `[BATCHIMAGER_OUTPUT] <path>`。
