import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "./util";

const HANDOFF_FILENAME = "runtime-handoff.json";

export interface RuntimeDriftEntry {
  path: string;
  status: "missing_live" | "conflict";
  legacyModifiedAt: string;
  liveModifiedAt?: string;
}

export interface RuntimeDriftReport {
  liveDataDir: string;
  legacyDataDir: string;
  since?: string;
  identicalCount: number;
  entries: RuntimeDriftEntry[];
}

export interface RuntimeHandoffMarker {
  createdAt: string;
  liveDataDir: string;
  legacyDataDirs: string[];
}

export function resolveRuntimeRoot(appRoot: string): string {
  return process.env.ATTENTION_RUNTIME_DIR ?? path.resolve(appRoot, "..", ".attention-workbench");
}

export function resolveDataDir(appRoot: string): string {
  return process.env.ATTENTION_DATA_DIR ?? path.join(resolveRuntimeRoot(appRoot), "data");
}

export function resolveArtifactsDir(appRoot: string): string {
  return process.env.ATTENTION_ARTIFACTS_DIR ?? path.join(resolveRuntimeRoot(appRoot), "output");
}

export async function writeRuntimeHandoffMarker(runtimeRoot: string, liveDataDir: string, legacyDataDir: string): Promise<RuntimeHandoffMarker> {
  const marker: RuntimeHandoffMarker = {
    createdAt: new Date().toISOString(),
    liveDataDir: path.resolve(liveDataDir),
    legacyDataDirs: [path.resolve(legacyDataDir)],
  };
  await writeJson(path.join(runtimeRoot, HANDOFF_FILENAME), marker);
  return marker;
}

export async function readRuntimeHandoffMarker(runtimeRoot: string): Promise<RuntimeHandoffMarker | null> {
  const filename = path.join(runtimeRoot, HANDOFF_FILENAME);
  return existsSync(filename) ? readJson<RuntimeHandoffMarker>(filename) : null;
}

export async function inspectRuntimeDrift(liveDataDir: string, legacyDataDir: string, since?: string): Promise<RuntimeDriftReport> {
  const live = path.resolve(liveDataDir);
  const legacy = path.resolve(legacyDataDir);
  if (live === legacy) throw new Error("Live and legacy runtime directories must be different.");
  const threshold = since ? Date.parse(since) : null;
  if (since && Number.isNaN(threshold)) throw new Error("Reconciliation --since must be an ISO timestamp.");
  const entries: RuntimeDriftEntry[] = [];
  let identicalCount = 0;
  for (const relativePath of await walkFiles(legacy)) {
    const legacyPath = path.join(legacy, relativePath);
    const legacyStats = await stat(legacyPath);
    if (threshold !== null && legacyStats.mtimeMs <= threshold) continue;
    const livePath = path.join(live, relativePath);
    if (!existsSync(livePath)) {
      entries.push({ path: relativePath, status: "missing_live", legacyModifiedAt: legacyStats.mtime.toISOString() });
      continue;
    }
    if (await fileDigest(legacyPath) === await fileDigest(livePath)) {
      identicalCount += 1;
      continue;
    }
    entries.push({
      path: relativePath,
      status: "conflict",
      legacyModifiedAt: legacyStats.mtime.toISOString(),
      liveModifiedAt: (await stat(livePath)).mtime.toISOString(),
    });
  }
  return { liveDataDir: live, legacyDataDir: legacy, ...(since ? { since } : {}), identicalCount, entries };
}

export async function reconcileMissingRuntimeFiles(liveDataDir: string, legacyDataDir: string, since?: string) {
  const report = await inspectRuntimeDrift(liveDataDir, legacyDataDir, since);
  const copied: string[] = [];
  for (const entry of report.entries) {
    if (entry.status !== "missing_live" || !isSafeAdditiveArtifact(entry.path)) continue;
    const source = path.join(report.legacyDataDir, entry.path);
    const destination = path.join(report.liveDataDir, entry.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    copied.push(entry.path);
  }
  return {
    ...report,
    copied,
    conflicts: report.entries.filter((entry) => entry.status === "conflict"),
    manualReview: report.entries.filter((entry) => entry.status === "missing_live" && !isSafeAdditiveArtifact(entry.path)),
  };
}

async function walkFiles(root: string, relative = ""): Promise<string[]> {
  if (!existsSync(root)) throw new Error(`Runtime directory not found: ${root}`);
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.name === ".mutation-lock" || entry.name.endsWith(".tmp")) continue;
    if (entry.isDirectory()) files.push(...await walkFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

async function fileDigest(filename: string): Promise<string> {
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

function isSafeAdditiveArtifact(relativePath: string): boolean {
  return /^feeds\/[^/]+\/(raw|runs|sweeps)\//.test(relativePath);
}
