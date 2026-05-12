import { describe, expect, test } from "vitest"
import {
  CloakBrowserBinaryPreparer,
  type CloakBrowserBinaryProvider,
  type CloakBrowserConsoleBridgeLike,
  type CloakBrowserEnvironmentLike,
  type CloakBrowserPreparationLockLike,
} from "../src/cloakbrowser/binary-preparer.js"
import type { FetchNotification } from "../src/fetch-events.js"
import { CloakbrowserConfigSchema } from "../src/schema.js"

type HarnessCalls = {
  apply: number
  acquire: number
  release: number
  restore: number
  clear: number
  ensure: number
  check: number
  downloadStarts: string[]
}

type HarnessOptions = {
  installed?: boolean
  updateAvailable?: boolean
  checkError?: Error
  ensureBinary?: (calls: HarnessCalls) => string | Promise<string>
}

function config(input: unknown = {}) {
  return CloakbrowserConfigSchema.parse(input)
}

function createHarness(options: HarnessOptions = {}) {
  const calls: HarnessCalls = {
    apply: 0,
    acquire: 0,
    release: 0,
    restore: 0,
    clear: 0,
    ensure: 0,
    check: 0,
    downloadStarts: [],
  }
  const environment: CloakBrowserEnvironmentLike = {
    apply() {
      calls.apply++
    },
  }
  const consoleBridge: CloakBrowserConsoleBridgeLike = {
    intercept() {
      return () => {
        calls.restore++
      }
    },
    notifyDownloadStart(message = "") {
      calls.downloadStarts.push(message)
    },
    clearDownloadState() {
      calls.clear++
    },
  }
  const preparationLock: CloakBrowserPreparationLockLike = {
    async acquire() {
      calls.acquire++
      return async () => {
        calls.release++
      }
    },
  }
  const binaryProvider: CloakBrowserBinaryProvider = {
    binaryInfo() {
      return { installed: options.installed ?? true }
    },
    ensureBinary() {
      calls.ensure++
      return options.ensureBinary?.(calls) ?? `/binary-${calls.ensure}`
    },
    checkForUpdate() {
      calls.check++
      if (options.checkError) throw options.checkError
      return options.updateAvailable ?? false
    },
  }

  return {
    calls,
    preparer: new CloakBrowserBinaryPreparer(environment, consoleBridge, preparationLock, binaryProvider),
  }
}

describe("CloakBrowserBinaryPreparer", () => {
  test("does nothing when the plugin is disabled", async () => {
    const { calls, preparer } = createHarness()

    await expect(preparer.prepare(config({ enabled: false }))).resolves.toBeUndefined()
    expect(calls.apply).toBe(0)
    expect(calls.ensure).toBe(0)
    expect(calls.acquire).toBe(0)
  })

  test("prepares the binary and announces a download when no binary is installed", async () => {
    const { calls, preparer } = createHarness({ installed: false })
    const notifications: FetchNotification[] = []

    const binaryPath = await preparer.prepare(config(), {
      notify(notification) {
        notifications.push(notification)
      },
    })

    expect(binaryPath).toBe("/binary-1")
    expect(calls.apply).toBe(1)
    expect(calls.acquire).toBe(1)
    expect(calls.ensure).toBe(1)
    expect(calls.release).toBe(1)
    expect(calls.restore).toBe(1)
    expect(calls.clear).toBe(1)
    expect(calls.downloadStarts).toEqual([""])
    expect(notifications.map((notification) => notification.message)).toContain("Preparing CloakBrowser browser binary.")
  })

  test("downloads again when auto update finds an available update", async () => {
    const { calls, preparer } = createHarness({ updateAvailable: true })

    const binaryPath = await preparer.prepare(config({ environment: { autoUpdate: true } }))

    expect(binaryPath).toBe("/binary-2")
    expect(calls.ensure).toBe(2)
    expect(calls.check).toBe(1)
  })

  test("reports update check failures without failing binary preparation", async () => {
    const { calls, preparer } = createHarness({ checkError: new Error("network down") })
    const notifications: FetchNotification[] = []

    const binaryPath = await preparer.prepare(config({ environment: { autoUpdate: true } }), {
      notify(notification) {
        notifications.push(notification)
      },
    })

    expect(binaryPath).toBe("/binary-1")
    expect(calls.ensure).toBe(1)
    expect(calls.check).toBe(1)
    expect(notifications).toContainEqual(
      expect.objectContaining({
        message: "Update check failed: network down",
        variant: "warning",
      }),
    )
  })

  test("shares in-flight preparation and replays the latest notification to late subscribers", async () => {
    let resolveEnsure: (binaryPath: string) => void = () => undefined
    const { calls, preparer } = createHarness({
      ensureBinary() {
        return new Promise<string>((resolve) => {
          resolveEnsure = resolve
        })
      },
    })
    const firstNotifications: FetchNotification[] = []
    const secondNotifications: FetchNotification[] = []
    const sharedConfig = config()

    const first = preparer.prepare(sharedConfig, {
      notify(notification) {
        firstNotifications.push(notification)
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    const second = preparer.prepare(sharedConfig, {
      notify(notification) {
        secondNotifications.push(notification)
      },
    })

    expect(firstNotifications.map((notification) => notification.message)).toContain(
      "Preparing CloakBrowser browser binary.",
    )
    expect(secondNotifications.map((notification) => notification.message)).toContain(
      "Preparing CloakBrowser browser binary.",
    )

    resolveEnsure("/shared-binary")

    await expect(Promise.all([first, second])).resolves.toEqual(["/shared-binary", "/shared-binary"])
    expect(calls.ensure).toBe(1)
    expect(calls.acquire).toBe(1)
    expect(calls.release).toBe(1)
  })
})
