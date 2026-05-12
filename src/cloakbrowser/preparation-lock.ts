import fs from "node:fs/promises"
import path from "node:path"
import type { FetchNotification, FetchOptions } from "../fetch-events.js"
import { sleep } from "../timing.js"
import { cloakBrowserEnvironment, type CloakBrowserEnvironment } from "./environment.js"

type PreparationLockOwner = {
  token?: string
  pid: number
  startedAt?: string
  updatedAt?: string
}

export class CloakBrowserPreparationLock {
  private readonly lockName = ".opencode-cloak-fetch-prepare.lock"
  private readonly pollMs = 1_000
  private readonly heartbeatMs = 5_000
  private readonly staleMs = 30_000

  constructor(private readonly environment: CloakBrowserEnvironment = cloakBrowserEnvironment) {}

  async acquire(options: FetchOptions = {}) {
    const lockPath = this.lockPath()
    await fs.mkdir(path.dirname(lockPath), { recursive: true })

    let waitingNotified = false
    while (true) {
      try {
        await fs.mkdir(lockPath)
        const owner: PreparationLockOwner = {
          token: this.newLockToken(),
          pid: process.pid,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        try {
          await this.writeOwner(lockPath, owner)
        } catch (error) {
          await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
          throw error
        }

        const heartbeat = setInterval(() => {
          void this.updateOwner(lockPath, owner).catch(() => undefined)
        }, this.heartbeatMs)
        heartbeat.unref?.()

        return async () => {
          clearInterval(heartbeat)
          const current = await this.readOwner(lockPath)
          if (current?.token === owner.token) await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        if (await this.removeStale(lockPath)) continue

        if (!waitingNotified) {
          waitingNotified = true
          this.notify(options, {
            title: "Cloak Fetch",
            message: "Another OpenCode instance is preparing the browser binary; waiting for it to finish.",
            variant: "info",
            duration: 8_000,
          })
        }

        await sleep(this.pollMs)
      }
    }
  }

  private notify(options: FetchOptions, notification: FetchNotification) {
    try {
      void Promise.resolve(options.notify?.(notification)).catch(() => undefined)
    } catch {
      // Notifications are best-effort and must not affect fetching.
    }
  }

  private lockPath() {
    return path.join(this.environment.cacheRoot(), this.lockName)
  }

  private ownerPath(lockPath: string) {
    return path.join(lockPath, "owner.json")
  }

  private newLockToken() {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  private async readOwner(lockPath: string): Promise<PreparationLockOwner | undefined> {
    try {
      const data = JSON.parse(await fs.readFile(this.ownerPath(lockPath), "utf8"))
      if (!this.isRecord(data)) return undefined
      if (typeof data.pid !== "number") return undefined
      if (data.token !== undefined && typeof data.token !== "string") return undefined
      if (data.startedAt !== undefined && typeof data.startedAt !== "string") return undefined
      if (data.updatedAt !== undefined && typeof data.updatedAt !== "string") return undefined
      return data as PreparationLockOwner
    } catch {
      return undefined
    }
  }

  private async writeOwner(lockPath: string, owner: PreparationLockOwner) {
    await fs.writeFile(this.ownerPath(lockPath), JSON.stringify({ ...owner, updatedAt: new Date().toISOString() }))
  }

  private async updateOwner(lockPath: string, owner: PreparationLockOwner) {
    const current = await this.readOwner(lockPath)
    if (current?.token !== owner.token) return
    await this.writeOwner(lockPath, owner)
  }

  private timestampMs(value: string | undefined) {
    if (!value) return undefined
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : undefined
  }

  private isProcessAlive(pid: number) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    if (pid === process.pid) return true

    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM"
    }
  }

  private async lockTimestamp(lockPath: string) {
    try {
      return (await fs.stat(this.ownerPath(lockPath))).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return (await fs.stat(lockPath)).mtimeMs
    }
  }

  private async removeStale(lockPath: string) {
    try {
      const owner = await this.readOwner(lockPath)
      const updatedAt = this.timestampMs(owner?.updatedAt)

      if (owner?.pid && !this.isProcessAlive(owner.pid)) {
        await fs.rm(lockPath, { recursive: true, force: true })
        return true
      }

      if (updatedAt !== undefined && Date.now() - updatedAt < this.staleMs) return false
      if (updatedAt === undefined && Date.now() - (await this.lockTimestamp(lockPath)) < this.staleMs) return false

      await fs.rm(lockPath, { recursive: true, force: true })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
      throw error
    }
  }
}

export const cloakBrowserPreparationLock = new CloakBrowserPreparationLock()
