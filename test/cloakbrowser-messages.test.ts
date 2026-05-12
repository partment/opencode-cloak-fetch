import { describe, expect, test } from "vitest"
import {
  cleanCloakbrowserMessage,
  isCloakbrowserMessage,
  isPrefixedCloakbrowserMessage,
  logLevel,
  notificationVariant,
} from "../src/cloakbrowser/messages.js"

describe("cloakbrowser message helpers", () => {
  test("distinguishes loggable CloakBrowser banner lines from toastable prefixed lines", () => {
    expect(isCloakbrowserMessage("  CloakBrowser — stealth Chromium for automation")).toBe(true)
    expect(isPrefixedCloakbrowserMessage("  CloakBrowser — stealth Chromium for automation")).toBe(false)
    expect(isPrefixedCloakbrowserMessage("[cloakbrowser] Download progress: 42%")).toBe(true)
  })

  test("cleans the CloakBrowser prefix from user-facing messages", () => {
    expect(cleanCloakbrowserMessage("[cloakbrowser] Binary ready")).toBe("Binary ready")
  })

  test("maps console messages to notification variants and log levels", () => {
    expect(notificationVariant("log", "Binary ready")).toBe("success")
    expect(notificationVariant("warn", "Update available")).toBe("warning")
    expect(notificationVariant("error", "Download failed")).toBe("error")
    expect(logLevel("warn")).toBe("warn")
    expect(logLevel("error")).toBe("error")
    expect(logLevel("log")).toBe("info")
  })
})
