import { describe, expect, test } from "vitest"
import { CloakBrowserDownloadNotifier } from "../src/cloakbrowser/download-notifier.js"
import type { FetchNotification } from "../src/fetch-events.js"

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe("CloakBrowserDownloadNotifier", () => {
  test("announces download start and includes the download source", () => {
    const notifications: FetchNotification[] = []
    const notifier = new CloakBrowserDownloadNotifier((notification) => notifications.push(notification), 5)

    notifier.handle("log", "[cloakbrowser] Downloading from https://example.com/chromium.zip")
    notifier.clear()

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      title: "Cloak Fetch",
      message: "Starting CloakBrowser browser binary download from https://example.com/chromium.zip",
      variant: "info",
    })
  })

  test("emits progress and repeats the latest progress while downloading", async () => {
    const notifications: FetchNotification[] = []
    const notifier = new CloakBrowserDownloadNotifier((notification) => notifications.push(notification), 5)

    notifier.handle("log", "[cloakbrowser] Download progress: 42%")
    const firstCount = notifications.length
    await delay(15)
    notifier.clear()

    expect(notifications.map((notification) => notification.message)).toContain(
      "Starting CloakBrowser browser binary download.",
    )
    expect(notifications.map((notification) => notification.message)).toContain("Downloading CloakBrowser: 42%")
    expect(notifications.length).toBeGreaterThan(firstCount)
    expect(notifications.at(-1)?.message).toBe("Downloading CloakBrowser: 42%")
  })

  test("stops repeating progress after completion", async () => {
    const notifications: FetchNotification[] = []
    const notifier = new CloakBrowserDownloadNotifier((notification) => notifications.push(notification), 5)

    notifier.handle("log", "[cloakbrowser] Download progress: 10%")
    notifier.handle("log", "[cloakbrowser] Download complete")
    const countAfterCompletion = notifications.length
    await delay(15)

    expect(notifications.length).toBe(countAfterCompletion)
    expect(notifications.at(-1)).toMatchObject({ message: "Download complete", variant: "success" })
  })
})
