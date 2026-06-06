#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const nextCachePath = join(process.cwd(), ".next");
const nextBinPath = join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

if (!existsSync(nextBinPath)) {
  console.error("Next is not installed yet. Run npm install first, then run npm run dev again.");
  process.exit(1);
}

await removeNextCache();

const devServer = spawn(process.execPath, [nextBinPath, "dev", "-H", "127.0.0.1", "-p", "3000"], {
  stdio: "inherit",
  shell: false
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    devServer.kill(signal);
  });
}

devServer.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
    return;
  }

  process.exit(code ?? 0);
});

async function removeNextCache() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      rmSync(nextCachePath, { recursive: true, force: true });
      console.log("Cleared stale Next cache before starting the dev server.");
      return;
    } catch (error) {
      if (attempt === 5) {
        console.error("Unable to clear the .next cache. Close any running dev server and try again.");
        throw error;
      }

      await delay(500 * attempt);
    }
  }
}
