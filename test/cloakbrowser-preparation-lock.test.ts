import { afterEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CloakBrowserEnvironment } from "../src/cloakbrowser/environment.js"
import { CloakBrowserPreparationLock } from "../src/cloakbrowser/preparation-lock.js"

const originalEnv = { ...process.env }
const tempRoots: string[] = []

afterEach(async () => {
  process.env = { ...originalEnv }
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-cloak-fetch-lock-"))
  tempRoots.push(dir)
  return dir
}

async function exists(file: string) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function lockPath(root: string) {
  return path.join(root, ".opencode-cloak-fetch-prepare.lock")
}

function ownerPath(root: string) {
  return path.join(lockPath(root), "owner.json")
}

describe("CloakBrowserPreparationLock", () => {
  test("creates a process lock and removes it on release", async () => {
    const root = await tempDir()
    process.env.CLOAKBROWSER_CACHE_DIR = root
    const lock = new CloakBrowserPreparationLock(new CloakBrowserEnvironment())

    const release = await lock.acquire()
    expect(await exists(lockPath(root))).toBe(true)

    await release()
    expect(await exists(lockPath(root))).toBe(false)
  })

  test("reclaims a lock owned by a dead process", async () => {
    const root = await tempDir()
    process.env.CLOAKBROWSER_CACHE_DIR = root
    await mkdir(lockPath(root), { recursive: true })
    await writeFile(
      ownerPath(root),
      JSON.stringify({
        token: "dead-owner",
        pid: 999_999_999,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    )

    const lock = new CloakBrowserPreparationLock(new CloakBrowserEnvironment())
    const release = await lock.acquire()
    const owner = JSON.parse(await readFile(ownerPath(root), "utf8"))

    expect(owner.token).not.toBe("dead-owner")
    expect(owner.pid).toBe(process.pid)

    await release()
  })
})
