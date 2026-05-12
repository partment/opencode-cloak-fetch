import { afterEach, describe, expect, test } from "vitest"
import { CloakBrowserEnvironment } from "../src/cloakbrowser/environment.js"
import { CloakbrowserConfigSchema } from "../src/schema.js"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("CloakBrowserEnvironment", () => {
  test("applies CloakBrowser environment variables from config", () => {
    const environment = new CloakBrowserEnvironment()
    const config = CloakbrowserConfigSchema.parse({
      environment: {
        autoUpdate: true,
        binaryPath: "/opt/chrome",
        cacheDir: "/tmp/cloak-cache",
        downloadUrl: "https://example.com/chrome.zip",
        skipChecksum: true,
      },
    })

    environment.apply(config)

    expect(process.env.CLOAKBROWSER_AUTO_UPDATE).toBe("true")
    expect(process.env.CLOAKBROWSER_BINARY_PATH).toBe("/opt/chrome")
    expect(process.env.CLOAKBROWSER_CACHE_DIR).toBe("/tmp/cloak-cache")
    expect(process.env.CLOAKBROWSER_DOWNLOAD_URL).toBe("https://example.com/chrome.zip")
    expect(process.env.CLOAKBROWSER_SKIP_CHECKSUM).toBe("true")
  })

  test("temporarily overrides and restores the binary path", () => {
    const environment = new CloakBrowserEnvironment()
    process.env.CLOAKBROWSER_BINARY_PATH = "/old/chrome"

    const restore = environment.withBinaryPath("/new/chrome")
    expect(process.env.CLOAKBROWSER_BINARY_PATH).toBe("/new/chrome")

    restore()
    expect(process.env.CLOAKBROWSER_BINARY_PATH).toBe("/old/chrome")
  })

  test("removes the temporary binary path when there was no previous value", () => {
    const environment = new CloakBrowserEnvironment()
    delete process.env.CLOAKBROWSER_BINARY_PATH

    const restore = environment.withBinaryPath("/new/chrome")
    restore()

    expect(process.env.CLOAKBROWSER_BINARY_PATH).toBeUndefined()
  })
})
