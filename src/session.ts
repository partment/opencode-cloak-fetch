import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { FetchLogEntry, FetchNotification, FetchOptions } from "./fetch-events.js"
import { getGlobalConfigDir } from "./paths.js"
import type { CloakbrowserConfig } from "./schema.js"
import { sleep } from "./timing.js"

const defaultSessionDirName = "cloakfetch-sessions"
const lockPollMs = 500
const lockHeartbeatMs = 5_000
const lockStaleMs = 60_000

type SessionLockOwner = {
  token?: string
  pid: number
  startedAt?: string
  updatedAt?: string
}

export type BrowserSessionProfile = {
  origin: string
  userDataDir: string
  lockPath: string
}

export type BrowserSession = BrowserSessionProfile & {
  release: () => Promise<void>
}

export function resolveBrowserSessionProfile(url: string, config: CloakbrowserConfig): BrowserSessionProfile | undefined {
  if (!config.session.enabled || hasConfiguredUserDataDir(config)) return undefined

  const origin = new URL(url).origin
  const dirName = profileDirName(origin)
  const root = path.resolve(config.session.cacheDir ?? path.join(getGlobalConfigDir(), defaultSessionDirName))

  return {
    origin,
    userDataDir: path.join(root, "profiles", dirName),
    lockPath: path.join(root, "locks", `${dirName}.lock`),
  }
}

export async function createBrowserSession(
  url: string,
  config: CloakbrowserConfig,
  options: FetchOptions = {},
): Promise<BrowserSession | undefined> {
  const profile = resolveBrowserSessionProfile(url, config)
  if (!profile) return undefined

  const release = await acquireProfileLock(profile, options)
  try {
    await fs.mkdir(profile.userDataDir, { recursive: true })
  } catch (error) {
    await release().catch(() => undefined)
    throw error
  }

  emitLog(options, {
    level: "debug",
    message: "Using persistent browser session profile",
    extra: {
      origin: profile.origin,
      userDataDir: profile.userDataDir,
    },
  })

  return { ...profile, release }
}

export function hasConfiguredUserDataDir(config: CloakbrowserConfig) {
  const userDataDir = config.cloakbrowser.launchOptions?.userDataDir
  return typeof userDataDir === "string" && userDataDir.trim().length > 0
}

export function profileDirName(origin: string) {
  const parsed = new URL(origin)
  const protocol = safePathPart(parsed.protocol.replace(/:$/, ""), "origin", 20)
  const host = safePathPart(parsed.hostname, "host", 80)
  const port = parsed.port ? `-${safePathPart(parsed.port, "port", 12)}` : ""
  const hash = crypto.createHash("sha256").update(parsed.origin).digest("hex").slice(0, 16)

  return `${protocol}-${host}${port}-${hash}`
}

async function acquireProfileLock(profile: BrowserSessionProfile, options: FetchOptions) {
  await fs.mkdir(path.dirname(profile.lockPath), { recursive: true })

  let waitingNotified = false
  while (true) {
    try {
      await fs.mkdir(profile.lockPath)
      const owner: SessionLockOwner = {
        token: newLockToken(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      try {
        await writeOwner(profile.lockPath, owner)
      } catch (error) {
        await fs.rm(profile.lockPath, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }

      const heartbeat = setInterval(() => {
        void updateOwner(profile.lockPath, owner).catch(() => undefined)
      }, lockHeartbeatMs)
      heartbeat.unref?.()

      return async () => {
        clearInterval(heartbeat)
        const current = await readOwner(profile.lockPath)
        if (current?.token === owner.token) await fs.rm(profile.lockPath, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (await removeStaleLock(profile.lockPath)) continue

      if (!waitingNotified) {
        waitingNotified = true
        emitNotification(options, {
          title: "Cloak Fetch",
          message: "Another webfetch is using this persistent session profile; waiting for it to finish.",
          variant: "info",
          duration: 8_000,
        })
        emitLog(options, {
          level: "info",
          message: "Waiting for persistent browser session profile lock",
          extra: { origin: profile.origin },
        })
      }

      await sleep(lockPollMs)
    }
  }
}

function safePathPart(value: string, fallback: string, maxLength: number) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, maxLength)
    .replace(/^[.-]+|[.-]+$/g, "")

  return safe || fallback
}

function newLockToken() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function ownerPath(lockPath: string) {
  return path.join(lockPath, "owner.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readOwner(lockPath: string): Promise<SessionLockOwner | undefined> {
  try {
    const data = JSON.parse(await fs.readFile(ownerPath(lockPath), "utf8"))
    if (!isRecord(data)) return undefined
    if (typeof data.pid !== "number") return undefined
    if (data.token !== undefined && typeof data.token !== "string") return undefined
    if (data.startedAt !== undefined && typeof data.startedAt !== "string") return undefined
    if (data.updatedAt !== undefined && typeof data.updatedAt !== "string") return undefined
    return data as SessionLockOwner
  } catch {
    return undefined
  }
}

async function writeOwner(lockPath: string, owner: SessionLockOwner) {
  await fs.writeFile(ownerPath(lockPath), JSON.stringify({ ...owner, updatedAt: new Date().toISOString() }))
}

async function updateOwner(lockPath: string, owner: SessionLockOwner) {
  const current = await readOwner(lockPath)
  if (current?.token !== owner.token) return
  await writeOwner(lockPath, owner)
}

function timestampMs(value: string | undefined) {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function lockTimestamp(lockPath: string) {
  try {
    return (await fs.stat(ownerPath(lockPath))).mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return (await fs.stat(lockPath)).mtimeMs
  }
}

async function removeStaleLock(lockPath: string) {
  try {
    const owner = await readOwner(lockPath)
    const updatedAt = timestampMs(owner?.updatedAt)

    if (owner?.pid && !isProcessAlive(owner.pid)) {
      await fs.rm(lockPath, { recursive: true, force: true })
      return true
    }

    if (updatedAt !== undefined && Date.now() - updatedAt < lockStaleMs) return false
    if (updatedAt === undefined && Date.now() - (await lockTimestamp(lockPath)) < lockStaleMs) return false

    await fs.rm(lockPath, { recursive: true, force: true })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
    throw error
  }
}

function emitNotification(options: FetchOptions, notification: FetchNotification) {
  try {
    void Promise.resolve(options.notify?.(notification)).catch(() => undefined)
  } catch {
    // Notifications are best-effort and must not affect fetching.
  }
}

function emitLog(options: FetchOptions, entry: FetchLogEntry) {
  void Promise.resolve(options.log?.(entry)).catch(() => undefined)
}
