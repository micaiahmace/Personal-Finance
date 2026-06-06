#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const nextBinPath = join(root, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(nextBinPath)) {
  console.error("Next is not installed yet. Run npm install first, then run npm run build again.");
  process.exit(1);
}

removeGeneratedTypeCache();

const build = spawn(process.execPath, [nextBinPath, "build"], {
  stdio: "inherit",
  shell: false
});

build.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});

function removeGeneratedTypeCache() {
  const targets = [
    join(root, ".next", "types"),
    join(root, ".next", "cache", ".tsbuildinfo")
  ];

  for (const target of targets) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}
