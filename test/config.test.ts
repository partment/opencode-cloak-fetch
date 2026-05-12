import { afterEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadConfig } from "../src/config.js"

const originalEnv = { ...process.env }
const tempRoots: string[] = []

afterEach(async () => {
  process.env = { ...originalEnv }
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-cloak-fetch-"))
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

describe("loadConfig", () => {
  test("merges global, OPENCODE_CONFIG_DIR, and nearest .opencode config", async () => {
    const root = await tempDir()
    const xdg = path.join(root, "xdg")
    const global = path.join(xdg, "opencode")
    const customDir = path.join(root, "custom")
    const project = path.join(root, "project")
    const parentOpencode = path.join(project, ".opencode")
    const nearestOpencode = path.join(project, "src", ".opencode")
    const nested = path.join(project, "src", "feature")

    await mkdir(global, { recursive: true })
    await mkdir(customDir, { recursive: true })
    await mkdir(parentOpencode, { recursive: true })
    await mkdir(nearestOpencode, { recursive: true })
    await mkdir(nested, { recursive: true })

    await writeFile(path.join(global, "cloakfetch.json"), `{ "maxChars": 10, "cloakbrowser": { "headless": false } }`)
    await writeFile(path.join(global, "cloakfetch.jsonc"), `{ "maxChars": 20, "timeout": { "launchMs": 1111 } }`)
    await writeFile(path.join(customDir, "cloakfetch.json"), `{ "timeout": { "navigationSeconds": 7 } }`)
    await writeFile(path.join(customDir, "cloakfetch.jsonc"), `{ "timeout": { "extractMs": 1234 } }`)
    await writeFile(path.join(parentOpencode, "cloakfetch.jsonc"), `{ "cloakbrowser": { "locale": "ignored" } }`)
    await writeFile(path.join(nearestOpencode, "cloakfetch.json"), `{ "cloakbrowser": { "locale": "en-US" } }`)
    await writeFile(path.join(nearestOpencode, "cloakfetch.jsonc"), `{ "maxChars": 30, "cloakbrowser": { "locale": "zh-TW" } }`)

    process.env.XDG_CONFIG_HOME = xdg
    process.env.OPENCODE_CONFIG_DIR = customDir

    const config = await loadConfig({ directory: nested, worktree: project })

    expect(config.maxChars).toBe(30)
    expect(config.timeout.launchMs).toBe(1111)
    expect(config.timeout.navigationSeconds).toBe(7)
    expect(config.timeout.extractMs).toBe(1234)
    expect(config.cloakbrowser.headless).toBe(false)
    expect(config.cloakbrowser.locale).toBe("zh-TW")
  })

  test("creates a global cloakfetch.jsonc when no global config exists", async () => {
    const root = await tempDir()
    const xdg = path.join(root, "xdg")
    process.env.XDG_CONFIG_HOME = xdg

    await loadConfig({ directory: root, worktree: root })

    const configPath = path.join(xdg, "opencode", "cloakfetch.jsonc")

    expect(await exists(configPath)).toBe(true)
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      $schema: "https://raw.githubusercontent.com/partment/opencode-cloak-fetch/main/configSchema.json",
    })
  })

})
