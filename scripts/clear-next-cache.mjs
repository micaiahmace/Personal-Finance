#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const nextPath = join(process.cwd(), ".next");

if (!existsSync(nextPath)) {
  console.log("No .next cache found.");
  process.exit(0);
}

rmSync(nextPath, { recursive: true, force: true });
console.log("Cleared .next. The next dev start will do a cold compile once.");
