import type { FetchLogEntry, FetchNotification, FetchOptions, LogHandler, NotificationHandler } from "../fetch-events.js"
import { CloakBrowserDownloadNotifier } from "./download-notifier.js"
import {
  cleanCloakbrowserMessage,
  cloakBrowserConsoleMethods,
  isCloakbrowserMessage,
  isPrefixedCloakbrowserMessage,
  logLevel,
  stringifyConsoleArg,
  type CloakBrowserConsoleMethod,
} from "./messages.js"

type ConsoleWriter = (...data: unknown[]) => void

export class CloakBrowserConsoleBridge {
  private readonly notificationHandlers = new Set<NotificationHandler>()
  private readonly logHandlers = new Set<LogHandler>()
  private readonly downloadNotifier = new CloakBrowserDownloadNotifier((notification) => this.emitNotification(notification))
  private originalConsole: Record<CloakBrowserConsoleMethod, ConsoleWriter> | undefined

  intercept(options: FetchOptions = {}) {
    if (!options.notify && !options.log) return () => undefined

    if (options.notify) this.notificationHandlers.add(options.notify)
    if (options.log) this.logHandlers.add(options.log)
    if (!this.originalConsole) this.install()

    let restored = false
    return () => {
      if (restored) return
      restored = true
      if (options.notify) this.notificationHandlers.delete(options.notify)
      if (options.log) this.logHandlers.delete(options.log)

      if (this.notificationHandlers.size === 0 && this.logHandlers.size === 0 && this.originalConsole) {
        for (const method of cloakBrowserConsoleMethods) {
          console[method] = this.originalConsole[method] as typeof console[typeof method]
        }
        this.originalConsole = undefined
      }
    }
  }

  clearDownloadState() {
    this.downloadNotifier.clear()
  }

  notifyDownloadStart(message = "") {
    this.downloadNotifier.start(message)
  }

  private install() {
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    }

    for (const method of cloakBrowserConsoleMethods) {
      console[method] = ((...data: unknown[]) => {
        const message = data.map(stringifyConsoleArg).join(" ")
        if (isCloakbrowserMessage(message)) {
          this.emitCloakbrowserLog(method, message)
          if (isPrefixedCloakbrowserMessage(message)) this.downloadNotifier.handle(method, message)
          return
        }
        this.originalConsole?.[method](...data)
      }) as typeof console[typeof method]
    }
  }

  private emitNotification(notification: FetchNotification) {
    for (const notify of [...this.notificationHandlers]) {
      try {
        void Promise.resolve(notify(notification)).catch(() => undefined)
      } catch {
        // Notifications are best-effort and must not affect fetching.
      }
    }
  }

  private emitLog(entry: FetchLogEntry) {
    for (const log of [...this.logHandlers]) {
      try {
        void Promise.resolve(log(entry)).catch(() => undefined)
      } catch {
        // Log writes are best-effort and must not affect fetching.
      }
    }
  }

  private emitCloakbrowserLog(method: CloakBrowserConsoleMethod, rawMessage: string) {
    const message = cleanCloakbrowserMessage(rawMessage)
    if (!message) return

    this.emitLog({
      level: logLevel(method),
      message,
      extra: {
        source: "cloakbrowser",
        consoleMethod: method,
        rawMessage,
      },
    })
  }
}

export const cloakBrowserConsoleBridge = new CloakBrowserConsoleBridge()
