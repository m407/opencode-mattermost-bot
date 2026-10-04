import { createHash } from "node:crypto";
import { opencodeClient } from "../../opencode/client.js";
import { getSessionDirectoryCache, setSessionDirectoryCache } from "../stores/settings-store.js";
import { isServerUnavailableError } from "../../utils/opencode-error.js";
import { isRecord } from "../../utils/type-guards.js";
import { logger } from "../../utils/logger.js";
import type { CachedSessionDirectory, SessionDirectoryProject } from "../types/session.js";

interface SessionDirectoryCacheData {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: CachedSessionDirectory[];
}

const CACHE_VERSION = 1;
const INITIAL_WARMUP_LIMIT = 1000;
const MAX_CACHED_DIRECTORIES = 10;
const SYNC_COOLDOWN_MS = 60_000;

const EMPTY_CACHE: SessionDirectoryCacheData = {
  version: CACHE_VERSION,
  lastSyncedUpdatedAt: 0,
  directories: [],
};

function createEmptyCacheData(): SessionDirectoryCacheData {
  return {
    version: EMPTY_CACHE.version,
    lastSyncedUpdatedAt: EMPTY_CACHE.lastSyncedUpdatedAt,
    directories: [],
  };
}

let cacheData: SessionDirectoryCacheData = createEmptyCacheData();
let cacheLoaded = false;
let syncInFlight: Promise<void> | null = null;
let lastSyncAttemptAt = 0;
let persistQueue: Promise<void> = Promise.resolve();

function worktreeKey(worktree: string): string {
  if (process.platform === "win32") {
    return worktree.toLowerCase();
  }

  return worktree;
}

function isValidWorktree(worktree: string): boolean {
  const trimmed = worktree.trim();
  return trimmed.length > 0 && trimmed !== "/";
}

function normalizeCacheData(raw: unknown): SessionDirectoryCacheData {
  if (!isRecord(raw)) {
    return createEmptyCacheData();
  }

  const lastSyncedUpdatedAt =
    typeof raw.lastSyncedUpdatedAt === "number" && Number.isFinite(raw.lastSyncedUpdatedAt)
      ? raw.lastSyncedUpdatedAt
      : 0;

  const directories: CachedSessionDirectory[] = Array.isArray(raw.directories)
    ? raw.directories
        .filter(
          (item): item is { worktree: string; lastUpdated: number } =>
            isRecord(item) &&
            typeof item.worktree === "string" &&
            typeof item.lastUpdated === "number",
        )
        .map((item) => ({
          worktree: item.worktree.trim(),
          lastUpdated: item.lastUpdated,
        }))
        .filter((item) => isValidWorktree(item.worktree))
    : [];

  const data: SessionDirectoryCacheData = {
    version: CACHE_VERSION,
    lastSyncedUpdatedAt,
    directories,
  };

  dedupeAndTrimDirectories(data);
  return data;
}

function dedupeAndTrimDirectories(data: SessionDirectoryCacheData): void {
  const unique = new Map<string, CachedSessionDirectory>();

  for (const item of data.directories) {
    const key = worktreeKey(item.worktree);
    const existing = unique.get(key);

    if (!existing || existing.lastUpdated < item.lastUpdated) {
      unique.set(key, item);
    }
  }

  data.directories = Array.from(unique.values())
    .sort((a, b) => b.lastUpdated - a.lastUpdated)
    .slice(0, MAX_CACHED_DIRECTORIES);
}

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) {
    return;
  }

  const storedCache = getSessionDirectoryCache();
  cacheData = normalizeCacheData(storedCache);
  cacheLoaded = true;
  logger.debug(
    `[SessionCache] Loaded ${cacheData.directories.length} directories from settings.sessionDirectoryCache`,
  );
}

function queuePersist(): Promise<void> {
  persistQueue = persistQueue
    .catch(() => {
      // Keep queue chain alive if previous write failed.
    })
    .then(async () => {
      try {
        await setSessionDirectoryCache(cacheData);
      } catch (error) {
        logger.error("[SessionCache] Failed to persist sessions cache", error);
      }
    });

  return persistQueue;
}

function upsertDirectory(worktree: string, lastUpdated: number): boolean {
  if (!isValidWorktree(worktree)) {
    return false;
  }

  const normalizedWorktree = worktree.trim();
  const key = worktreeKey(normalizedWorktree);
  const existingIndex = cacheData.directories.findIndex(
    (item) => worktreeKey(item.worktree) === key,
  );

  if (existingIndex >= 0) {
    const existing = cacheData.directories[existingIndex];
    if (!existing || existing.lastUpdated >= lastUpdated) {
      return false;
    }

    cacheData.directories[existingIndex] = {
      worktree: existing.worktree,
      lastUpdated,
    };
  } else {
    cacheData.directories.push({
      worktree: normalizedWorktree,
      lastUpdated,
    });
  }

  dedupeAndTrimDirectories(cacheData);
  return true;
}

function createVirtualProjectId(worktree: string): string {
  const hash = createHash("sha1").update(worktree).digest("hex").slice(0, 16);
  return `dir_${hash}`;
}

async function runSync(options?: { force?: boolean }): Promise<void> {
  await ensureCacheLoaded();

  const shouldPrune = options?.force || cacheData.lastSyncedUpdatedAt === 0;
  const params = { limit: INITIAL_WARMUP_LIMIT };
  const { data: sessions, error } = await opencodeClient.session.list(params);

  if (error || !sessions) {
    throw error || new Error("No session list received from server");
  }

  let changed = false;
  let maxUpdated = cacheData.lastSyncedUpdatedAt;
  const seenDirectories = new Set<string>();

  for (const session of sessions) {
    const updatedAt = session.time?.updated ?? Date.now();
    if (upsertDirectory(session.directory, updatedAt)) {
      changed = true;
    }

    if (session.directory && isValidWorktree(session.directory)) {
      seenDirectories.add(worktreeKey(session.directory.trim()));
    }

    if (updatedAt > maxUpdated) {
      maxUpdated = updatedAt;
    }
  }

  const responseIsTruncated = sessions.length >= INITIAL_WARMUP_LIMIT;

  if (shouldPrune && !responseIsTruncated) {
    const before = cacheData.directories.length;
    cacheData.directories = cacheData.directories.filter((d) =>
      seenDirectories.has(worktreeKey(d.worktree)),
    );
    if (cacheData.directories.length !== before) {
      changed = true;
      logger.info(
        `[SessionCache] Pruned ${before - cacheData.directories.length} stale directories from cache`,
      );
    }
  }

  if (maxUpdated !== cacheData.lastSyncedUpdatedAt) {
    cacheData.lastSyncedUpdatedAt = maxUpdated;
    changed = true;
  }

  if (changed) {
    await queuePersist();
  }

  logger.debug(
    `[SessionCache] Synced sessions: fetched=${sessions.length}, directories=${cacheData.directories.length}, lastSyncedUpdatedAt=${cacheData.lastSyncedUpdatedAt}`,
  );
}

export async function warmupSessionDirectoryCache(): Promise<void> {
  await syncSessionDirectoryCache({ force: true });
}

export async function syncSessionDirectoryCache(options?: { force?: boolean }): Promise<void> {
  await ensureCacheLoaded();

  if (!options?.force && Date.now() - lastSyncAttemptAt < SYNC_COOLDOWN_MS) {
    return;
  }

  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = runSync(options)
    .then(() => {
      lastSyncAttemptAt = Date.now();
    })
    .catch((error) => {
      if (isServerUnavailableError(error)) {
        logger.warn("[SessionCache] OpenCode server is not running. Start it with: opencode serve");
      } else {
        logger.warn("[SessionCache] Failed to sync sessions cache", error);
      }

      lastSyncAttemptAt = 0;
    })
    .finally(() => {
      syncInFlight = null;
    });

  return syncInFlight;
}

export async function getCachedSessionDirectories(): Promise<CachedSessionDirectory[]> {
  await ensureCacheLoaded();
  return cacheData.directories.map((item) => ({ ...item }));
}

export async function getCachedSessionProjects(): Promise<SessionDirectoryProject[]> {
  const directories = await getCachedSessionDirectories();

  return directories.map((item) => ({
    id: createVirtualProjectId(item.worktree),
    worktree: item.worktree,
    name: item.worktree,
    lastUpdated: item.lastUpdated,
  }));
}

export async function upsertSessionDirectory(
  worktree: string,
  lastUpdated: number = Date.now(),
): Promise<void> {
  await ensureCacheLoaded();

  if (!upsertDirectory(worktree, lastUpdated)) {
    return;
  }

  if (lastUpdated > cacheData.lastSyncedUpdatedAt) {
    cacheData.lastSyncedUpdatedAt = lastUpdated;
  }

  await queuePersist();
}

export async function ingestSessionInfoForCache(session: {
  directory?: string;
  time?: { updated?: number };
}): Promise<void> {
  const directory = session.directory;
  if (!directory) {
    return;
  }

  const updated = session.time?.updated ?? Date.now();
  await upsertSessionDirectory(directory, updated);
}

export function __resetSessionDirectoryCacheForTests(): void {
  cacheData = createEmptyCacheData();
  cacheLoaded = false;
  syncInFlight = null;
  lastSyncAttemptAt = 0;
  persistQueue = Promise.resolve();
}
