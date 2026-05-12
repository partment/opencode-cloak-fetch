import {
  binaryInfo as cloakBrowserBinaryInfo,
  checkForUpdate as cloakBrowserCheckForUpdate,
  ensureBinary as cloakBrowserEnsureBinary,
} from "cloakbrowser"
import type { FetchLogEntry, FetchNotification, FetchOptions, LogHandler, NotificationHandler } from "../fetch-events.js"
import type { CloakbrowserConfig } from "../schema.js"
import { CloakBrowserConsoleBridge, cloakBrowserConsoleBridge } from "./console-bridge.js"
import { CloakBrowserEnvironment, cloakBrowserEnvironment } from "./environment.js"
import { CloakBrowserPreparationLock, cloakBrowserPreparationLock } from "./preparation-lock.js"

type PreparationState = {
  promise: Promise<string>
  notifiers: Set<NotificationHandler>
  loggers: Set<LogHandler>
  latest?: FetchNotification
}

type CloakBrowserUpdateCheckResult = boolean | string | null | undefined

export type CloakBrowserBinaryProvider = {
  binaryInfo: () => { installed: boolean }
  ensureBinary: () => string | Promise<string>
  checkForUpdate: () => CloakBrowserUpdateCheckResult | Promise<CloakBrowserUpdateCheckResult>
}

export type CloakBrowserEnvironmentLike = Pick<CloakBrowserEnvironment, "apply">
export type CloakBrowserConsoleBridgeLike = Pick<
  CloakBrowserConsoleBridge,
  "intercept" | "notifyDownloadStart" | "clearDownloadState"
>
export type CloakBrowserPreparationLockLike = Pick<CloakBrowserPreparationLock, "acquire">

const cloakBrowserBinaryProvider = {
  binaryInfo: cloakBrowserBinaryInfo,
  ensureBinary: cloakBrowserEnsureBinary,
  checkForUpdate: cloakBrowserCheckForUpdate,
} satisfies CloakBrowserBinaryProvider

export class CloakBrowserBinaryPreparer {
  private readonly preparations = new Map<string, PreparationState>()

  constructor(
    private readonly environment: CloakBrowserEnvironmentLike = cloakBrowserEnvironment,
    private readonly consoleBridge: CloakBrowserConsoleBridgeLike = cloakBrowserConsoleBridge,
    private readonly preparationLock: CloakBrowserPreparationLockLike = cloakBrowserPreparationLock,
    private readonly binaryProvider: CloakBrowserBinaryProvider = cloakBrowserBinaryProvider,
  ) {}

  async prepare(config: CloakbrowserConfig, options: FetchOptions = {}) {
    if (!config.enabled) return

    this.environment.apply(config, false)

    const key = this.preparationKey(config)
    const existing = this.preparations.get(key)
    if (existing) {
      const removeHandlers = this.addHandlers(existing, options)
      try {
        return await existing.promise
      } finally {
        removeHandlers()
      }
    }

    const state = { notifiers: new Set<NotificationHandler>(), loggers: new Set<LogHandler>() } as PreparationState
    const stateOptions: FetchOptions = {
      notify: (notification) => this.emitNotification(state, notification),
      log: (entry) => this.emitLog(state, entry),
    }

    state.promise = this.prepareBinary(config, stateOptions)
    this.preparations.set(key, state)
    void state.promise.then(
      () => {
        state.latest = undefined
      },
      () => {
        this.preparations.delete(key)
      },
    )

    const removeHandlers = this.addHandlers(state, options)
    try {
      return await state.promise
    } finally {
      removeHandlers()
    }
  }

  private async prepareBinary(config: CloakbrowserConfig, options: FetchOptions) {
    const restoreConsole = this.consoleBridge.intercept(options)
    let releaseLock: (() => Promise<void>) | undefined
    try {
      releaseLock = await this.preparationLock.acquire(options)
      this.notify(options, {
        title: "Cloak Fetch",
        message: "Preparing CloakBrowser browser binary.",
        variant: "info",
        duration: 5_000,
      })
      if (!config.environment.binaryPath && !this.binaryProvider.binaryInfo().installed) {
        this.consoleBridge.notifyDownloadStart()
      }
      let binaryPath = await this.binaryProvider.ensureBinary()

      if (this.shouldCheckForUpdate(config)) {
        try {
          if (await this.binaryProvider.checkForUpdate()) binaryPath = await this.binaryProvider.ensureBinary()
        } catch (error) {
          this.notify(options, {
            title: "Cloak Fetch",
            message: `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
            variant: "warning",
            duration: 8_000,
          })
        }
      }

      return binaryPath
    } finally {
      this.consoleBridge.clearDownloadState()
      await releaseLock?.()
      restoreConsole()
    }
  }

  private notify(options: FetchOptions, notification: FetchNotification) {
    try {
      void Promise.resolve(options.notify?.(notification)).catch(() => undefined)
    } catch {
      // Notifications are best-effort and must not affect fetching.
    }
  }

  private emitNotification(state: PreparationState, notification: FetchNotification) {
    state.latest = notification
    for (const notify of [...state.notifiers]) {
      try {
        void Promise.resolve(notify(notification)).catch(() => undefined)
      } catch {
        // Notifications are best-effort and must not affect fetching.
      }
    }
  }

  private emitLog(state: PreparationState, entry: FetchLogEntry) {
    for (const log of [...state.loggers]) {
      try {
        void Promise.resolve(log(entry)).catch(() => undefined)
      } catch {
        // Log writes are best-effort and must not affect fetching.
      }
    }
  }

  private addHandlers(state: PreparationState, options: FetchOptions) {
    const notify = options.notify
    const log = options.log

    if (notify) state.notifiers.add(notify)
    if (log) state.loggers.add(log)
    if (notify && state.latest) {
      try {
        void Promise.resolve(notify(state.latest)).catch(() => undefined)
      } catch {
        // Notifications are best-effort and must not affect fetching.
      }
    }

    return () => {
      if (notify) state.notifiers.delete(notify)
      if (log) state.loggers.delete(log)
    }
  }

  private preparationKey(config: CloakbrowserConfig) {
    return JSON.stringify(config.environment)
  }

  private shouldCheckForUpdate(config: CloakbrowserConfig) {
    return config.environment.autoUpdate && !config.environment.binaryPath && !config.environment.downloadUrl
  }
}

export const cloakBrowserBinaryPreparer = new CloakBrowserBinaryPreparer()
