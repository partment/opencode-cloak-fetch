import { afterEach, describe, expect, test } from "vitest"
import { CloakBrowserConsoleBridge } from "../src/cloakbrowser/console-bridge.js"
import type { FetchLogEntry, FetchNotification } from "../src/fetch-events.js"

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
}

afterEach(() => {
  console.log = originalConsole.log
  console.warn = originalConsole.warn
  console.error = originalConsole.error
})

describe("CloakBrowserConsoleBridge", () => {
  test("logs all CloakBrowser output but only notifies prefixed messages", () => {
    const bridge = new CloakBrowserConsoleBridge()
    const logs: FetchLogEntry[] = []
    const notifications: FetchNotification[] = []
    const restore = bridge.intercept({
      log(entry) {
        logs.push(entry)
      },
      notify(notification) {
        notifications.push(notification)
      },
    })

    try {
      console.log("[cloakbrowser] Binary ready")
      console.log("  CloakBrowser — stealth Chromium for automation")
    } finally {
      restore()
    }

    expect(logs.map((entry) => entry.message)).toEqual([
      "Binary ready",
      "CloakBrowser — stealth Chromium for automation",
    ])
    expect(notifications.map((notification) => notification.message)).toEqual(["Binary ready"])
  })

  test("suppresses CloakBrowser output and passes through unrelated console output", () => {
    const passthrough: unknown[][] = []
    console.warn = (...data: unknown[]) => {
      passthrough.push(data)
    }

    const bridge = new CloakBrowserConsoleBridge()
    const logs: FetchLogEntry[] = []
    const restore = bridge.intercept({
      log(entry) {
        logs.push(entry)
      },
    })

    try {
      console.warn("plain warning", 123)
      console.warn("[cloakbrowser] Update available")
    } finally {
      restore()
    }

    expect(passthrough).toEqual([["plain warning", 123]])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ level: "warn", message: "Update available" })
  })
})
