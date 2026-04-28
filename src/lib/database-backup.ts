import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

type BackupResult = {
  backupFilePath: string;
  databaseName: string;
  fileName: string;
};

function formatTimestamp(date: Date) {
  const yyyy = date.getFullYear().toString();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  return databaseUrl;
}

function parseDatabaseName(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const rawName = parsed.pathname.replace(/^\//, "").trim();

  if (!rawName) {
    throw new Error("Could not determine database name from DATABASE_URL.");
  }

  return rawName;
}

function toPgDumpConnectionString(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const allowedParams = new Set(["sslmode", "sslcert", "sslkey", "sslrootcert", "connect_timeout", "application_name"]);

  const keptParams = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (allowedParams.has(key)) {
      keptParams.append(key, value);
    }
  }

  parsed.search = keptParams.toString() ? `?${keptParams.toString()}` : "";
  return parsed.toString();
}

function getPgDumpCommand() {
  return process.env.PG_DUMP_PATH?.trim() || "pg_dump";
}

export function validateBackupFolderPath(folderPath: string | null | undefined) {
  const trimmed = (folderPath || "").trim();

  if (!trimmed) {
    return "Backup folder path is required.";
  }

  if (!path.isAbsolute(trimmed)) {
    return "Backup folder path must be an absolute path.";
  }

  return null;
}

export async function createPostgresBackup(backupFolderPath: string): Promise<BackupResult> {
  const validationError = validateBackupFolderPath(backupFolderPath);

  if (validationError) {
    throw new Error(validationError);
  }

  const databaseUrl = getDatabaseUrl();
  const pgDumpConnectionString = toPgDumpConnectionString(databaseUrl);
  const parsed = new URL(databaseUrl);
  const databaseName = parseDatabaseName(databaseUrl);
  const timestamp = formatTimestamp(new Date());
  const fileName = `${databaseName}_${timestamp}.backup`;
  const backupFilePath = path.join(backupFolderPath, fileName);

  await mkdir(backupFolderPath, { recursive: true });

  const env = { ...process.env };
  if (parsed.password) {
    env.PGPASSWORD = decodeURIComponent(parsed.password);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(getPgDumpCommand(), ["--format=custom", `--file=${backupFilePath}`, pgDumpConnectionString], {
      shell: false,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start pg_dump. ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`pg_dump failed with exit code ${String(code)}.${stderr ? ` ${stderr.trim()}` : ""}`));
    });
  });

  return {
    backupFilePath,
    databaseName,
    fileName,
  };
}
