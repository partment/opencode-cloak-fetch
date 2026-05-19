import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createBrowserSession, hasConfiguredUserDataDir, profileDirName, resolveBrowserSessionProfile } from "../src/session.js"
import { CloakbrowserConfigSchema, type CloakbrowserConfigInput } from "../src/schema.js"

const originalEnv = { ...process.env }
const tempRoots: string[] = []

afterEach(async () => {
  process.env = { ...originalEnv }
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function config(input: CloakbrowserConfigInput = {}) {
  return CloakbrowserConfigSchema.parse(input)
}

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-cloak-fetch-session-"))
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

describe("browser session profiles", () => {
  test("are disabled by default", () => {
    const profile = resolveBrowserSessionProfile("https://example.com/path", config())

    expect(profile).toBeUndefined()
  })

  test("uses one stable profile per URL origin", () => {
    const cacheDir = path.join("tmp", "sessions")
    const enabledConfig = config({ session: { enabled: true, cacheDir } })

    const first = resolveBrowserSessionProfile("https://example.com/a?x=1", enabledConfig)
    const second = resolveBrowserSessionProfile("https://example.com/b?x=2", enabledConfig)
    const differentPort = resolveBrowserSessionProfile("https://example.com:8443/a", enabledConfig)

    expect(first?.origin).toBe("https://example.com")
    expect(first?.userDataDir).toBe(second?.userDataDir)
    expect(first?.lockPath).toBe(second?.lockPath)
    expect(first?.userDataDir).toBe(path.join(path.resolve(cacheDir), "profiles", profileDirName("https://example.com")))
    expect(differentPort?.origin).toBe("https://example.com:8443")
    expect(differentPort?.userDataDir).not.toBe(first?.userDataDir)
  })

  test("does not leak URL credentials, paths, or query strings into profile paths", () => {
    const enabledConfig = config({ session: { enabled: true, cacheDir: "./sessions" } })

    const profile = resolveBrowserSessionProfile(
      "https://user:secret@example.com:8443/private/path?token=abc",
      enabledConfig,
    )

    expect(profile?.origin).toBe("https://example.com:8443")
    expect(profile?.userDataDir).toContain("example.com")
    expect(profile?.userDataDir).not.toContain("secret")
    expect(profile?.userDataDir).not.toContain("private")
    expect(profile?.userDataDir).not.toContain("token")
  })

  test("uses the global OpenCode config directory when cacheDir is unset", () => {
    const xdg = path.join(process.cwd(), "tmp-xdg")
    process.env.XDG_CONFIG_HOME = xdg

    const profile = resolveBrowserSessionProfile("https://example.com", config({ session: { enabled: true } }))

    expect(profile?.userDataDir).toBe(
      path.join(xdg, "opencode", "cloakfetch-sessions", "profiles", profileDirName("https://example.com")),
    )
  })

  test("skips automatic origin profiles when launchOptions.userDataDir is explicit", () => {
    const enabledConfig = config({
      session: { enabled: true, cacheDir: "./sessions" },
      cloakbrowser: { launchOptions: { userDataDir: "./manual-profile" } },
    })

    expect(hasConfiguredUserDataDir(enabledConfig)).toBe(true)
    expect(resolveBrowserSessionProfile("https://example.com", enabledConfig)).toBeUndefined()
  })

  test("creates the profile directory and releases its lock", async () => {
    const cacheDir = await tempDir()

    const session = await createBrowserSession("https://example.com", config({ session: { enabled: true, cacheDir } }))
    expect(session).toBeTruthy()
    if (!session) throw new Error("Expected browser session")

    expect(await exists(session.userDataDir)).toBe(true)
    expect(await exists(session.lockPath)).toBe(true)

    await session.release()

    expect(await exists(session.lockPath)).toBe(false)
  })
})
