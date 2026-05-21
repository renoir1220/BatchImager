import { execFileSync } from "node:child_process";

const port = Number(process.argv[2] ?? 5173);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[kdev] Invalid port: ${process.argv[2]}`);
  process.exit(1);
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function findListeningPids(targetPort) {
  if (process.platform === "win32") {
    const output = run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        `$pids = Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue`,
        "| Select-Object -ExpandProperty OwningProcess -Unique;",
        '$pids -join "`n"'
      ].join(" ")
    ]);

    return output.split(/\r?\n/);
  }

  const output = run("lsof", [
    "-ti",
    `TCP:${targetPort}`,
    "-sTCP:LISTEN"
  ]);

  return output.split(/\r?\n/);
}

function killPid(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    return;
  }

  process.kill(pid, "SIGTERM");
}

let pids = [];

try {
  pids = findListeningPids(port)
    .map((value) => Number(value.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
} catch {
  pids = [];
}

if (pids.length === 0) {
  console.log(`[kdev] Port ${port} is free.`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    killPid(pid);
    console.log(`[kdev] Killed process ${pid} listening on port ${port}.`);
  } catch (error) {
    console.error(`[kdev] Failed to kill process ${pid}: ${error.message}`);
    process.exitCode = 1;
  }
}
