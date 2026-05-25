#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDir = path.join(root, "release");
const stagingReleaseDir = path.join(os.tmpdir(), "batchimager-private-mac-release");
const productName = packageJson.build?.productName ?? packageJson.productName ?? packageJson.name;
const version = packageJson.version;

// 支持的架构：arm64 / x64 / universal。默认跟随当前机器的 arm64/x64。
const SUPPORTED_ARCHES = new Set(["arm64", "x64", "universal"]);
const defaultArch = process.arch === "arm64" ? "arm64" : "x64";
const arch = parseArchArg(process.argv.slice(2)) ?? defaultArch;
if (!SUPPORTED_ARCHES.has(arch)) {
  throw new Error(`Unsupported --arch=${arch}. Use one of: ${[...SUPPORTED_ARCHES].join(", ")}`);
}

// 签名模式：默认 adhoc（无 Developer ID 私下分发）；developer-id 是将来切换公证流程的占位。
const signMode = (process.env.BATCHIMAGER_SIGN_MODE ?? "adhoc").trim();
if (signMode !== "adhoc" && signMode !== "developer-id") {
  throw new Error(`Unsupported BATCHIMAGER_SIGN_MODE=${signMode}. Use "adhoc" or "developer-id".`);
}
if (signMode === "developer-id") {
  throw new Error(
    [
      "BATCHIMAGER_SIGN_MODE=developer-id 还未实现。",
      "需要先准备好：",
      "1) Apple Developer ID Application 证书已安装到登录钥匙串；",
      "2) 设置 CSC_NAME 环境变量为该证书的 Common Name；",
      "3) 配置 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 用于 notarytool；",
      "4) 在 build/entitlements.mac.plist 中补全所需 entitlements。",
      "目前脚本只保留 adhoc 路径，正式公证流程待后续实现。"
    ].join("\n")
  );
}

// electron-builder 对不同架构的输出子目录命名不一致，这里集中映射。
const ARCH_OUTPUT_DIR = {
  arm64: "mac-arm64",
  x64: "mac",
  universal: "mac-universal"
};
const ARCH_BUILDER_FLAG = {
  arm64: "--arm64",
  x64: "--x64",
  universal: "--universal"
};

const appOutputDir = path.join(stagingReleaseDir, ARCH_OUTPUT_DIR[arch]);
const appPath = path.join(appOutputDir, `${productName}.app`);
const zipName = `${productName}-${version}-${arch}-private.zip`;
const zipPath = path.join(releaseDir, zipName);
const stagingZipPath = path.join(stagingReleaseDir, zipName);
const verifyDir = path.join(stagingReleaseDir, ".verify-private-zip");
const readmePath = path.join(releaseDir, "README-private-mac.txt");

run("npm", ["run", "build"]);
cleanRelease();
cleanStagingRelease();

run("xattr", ["-rc", path.join(root, "node_modules", "electron", "dist", "Electron.app")], { allowFailure: true });
run("xattr", ["-rc", path.join(root, "resources")], { allowFailure: true });
run("xattr", ["-rc", path.join(root, "src", "assets", "app-icons")], { allowFailure: true });

run(
  "npx",
  [
    "electron-builder",
    "--mac",
    "dir",
    ARCH_BUILDER_FLAG[arch],
    `--config.directories.output=${stagingReleaseDir}`
  ],
  {
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    }
  }
);

if (!existsSync(appPath)) {
  throw new Error(`Expected packaged app at ${appPath}`);
}

run("xattr", ["-rc", appPath], { allowFailure: true });
// ad-hoc 签名：不启用 Hardened Runtime（runtime flag 只有配合 Apple 公证才有意义，
// 在没有 entitlements 的 ad-hoc 场景下反而可能影响 Electron 的 JIT 行为）。
run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
run("xattr", ["-rc", appPath], { allowFailure: true });
run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);

run("ditto", ["-c", "-k", "--keepParent", "--sequesterRsrc", "--zlibCompressionLevel", "9", `${productName}.app`, stagingZipPath], {
  cwd: path.dirname(appPath)
});
run("ditto", [stagingZipPath, zipPath]);

rmSync(verifyDir, { force: true, recursive: true });
mkdirSync(verifyDir, { recursive: true });
run("ditto", ["-x", "-k", zipPath, verifyDir]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", path.join(verifyDir, `${productName}.app`)]);
rmSync(verifyDir, { force: true, recursive: true });

writeFileSync(
  readmePath,
  [
    "Esse macOS 私下分发包",
    "",
    `压缩包：release/${zipName}`,
    `架构：${arch}`,
    "",
    "这是无 Apple Developer ID 证书场景下的私下分发包：",
    "- app 已做 ad-hoc 签名，并通过 codesign --verify。",
    "- app 在系统临时目录完成签名和压缩，避免 Documents/iCloud/File Provider 给 .app 注入 FinderInfo 导致“已损坏”。",
    "- release 目录只保留已验证的 zip 和这份说明；旧的 dmg、裸 app、失败产物会在打包时清理。",
    "- 因为没有 Developer ID 签名和 Apple 公证，首次在其他 Mac 打开时 Gatekeeper 仍可能提示无法验证开发者。",
    "",
    "推荐打开方式：",
    "1. 解压 zip。",
    "2. 把 Esse.app 拖到 Applications（应用程序）目录。",
    "3. 第一次打开时按住 Control 右键点击 Esse.app，选择“打开”，再确认打开。",
    "",
    "如果文件经过微信/浏览器后仍显示“已损坏，无法打开”，说明传输工具加了 quarantine 标记；仅对你信任的本包执行：",
    "xattr -dr com.apple.quarantine /Applications/Esse.app",
    "然后再次 Control + 右键打开。",
    "",
    "正式公开分发仍需要 Apple Developer ID Application 证书并 notarize。"
  ].join("\n") + "\n",
  "utf8"
);

console.log(`Created ${zipPath}`);
console.log(`Verified ${appPath}`);
console.log(`Wrote ${readmePath}`);

function cleanRelease() {
  // maxRetries 容忍 macOS 偶发的 .DS_Store / iCloud 竞争性创建。
  rmSync(releaseDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(releaseDir, { recursive: true });
}

function cleanStagingRelease() {
  rmSync(stagingReleaseDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(stagingReleaseDir, { recursive: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

// 仅解析 --arch=xxx 或 --arch xxx 形式，忽略其他参数。
function parseArchArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--arch=")) {
      return arg.slice("--arch=".length).trim();
    }
    if (arg === "--arch") {
      return (argv[i + 1] ?? "").trim();
    }
  }
  return null;
}
