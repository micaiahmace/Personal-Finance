import { mkdir, readdir, stat, copyFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const databasePath = path.join(process.cwd(), "prisma", "dev.db");
const backupDirectory = path.join(process.cwd(), "prisma", "backups");

export async function GET() {
  return NextResponse.json({ backups: await listBackups() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({} as { action?: string }));
  const action = typeof body.action === "string" ? body.action : "backup";

  if (action === "restore-latest") {
    return restoreLatestBackup();
  }

  return createBackup();
}

async function createBackup() {
  await mkdir(backupDirectory, { recursive: true });
  await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL)").catch(() => undefined);

  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-finance-dev.db`;
  const targetPath = path.join(backupDirectory, fileName);
  await copyFile(databasePath, targetPath);

  return NextResponse.json({
    ok: true,
    backup: (await listBackups()).find((backup) => backup.fileName === fileName) || null
  });
}

async function restoreLatestBackup() {
  const backups = await listBackups();
  const latest = backups[0];
  if (!latest) {
    return NextResponse.json({ ok: false, error: "No local backups found." }, { status: 404 });
  }

  await prisma.$disconnect();
  await copyFile(path.join(backupDirectory, latest.fileName), databasePath);

  return NextResponse.json({
    ok: true,
    restored: latest
  });
}

async function listBackups() {
  await mkdir(backupDirectory, { recursive: true });
  const fileNames = (await readdir(backupDirectory)).filter((fileName) => fileName.endsWith(".db"));
  const backups = await Promise.all(
    fileNames.map(async (fileName) => {
      const info = await stat(path.join(backupDirectory, fileName));
      return {
        fileName,
        createdAt: info.birthtime.toISOString(),
        modifiedAt: info.mtime.toISOString(),
        size: info.size
      };
    })
  );

  return backups.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
