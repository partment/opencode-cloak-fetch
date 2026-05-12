import type { FetchNotification } from "../fetch-events.js"
import {
  cleanCloakbrowserMessage,
  notificationVariant,
  type CloakBrowserConsoleMethod,
} from "./messages.js"

type NotificationSink = (notification: FetchNotification) => void

export class CloakBrowserDownloadNotifier {
  private latestProgress: string | undefined
  private progressTimer: ReturnType<typeof setTimeout> | undefined
  private startMessage: string | undefined
  private startTimer: ReturnType<typeof setTimeout> | undefined
  private startNotified = false

  constructor(
    private readonly emit: NotificationSink,
    private readonly heartbeatMs = 5_000,
  ) {}

  start(message = "") {
    this.emitDownloadStart(message)
  }

  handle(method: CloakBrowserConsoleMethod, rawMessage: string) {
    const message = cleanCloakbrowserMessage(rawMessage)
    if (!message) return

    if (this.isDownloadStart(message)) {
      this.emitDownloadStart(message)
      return
    }

    const progress = this.downloadProgressText(message)
    if (progress) {
      if (!this.startNotified) this.emitDownloadStart("")
      this.clearDownloadStartHeartbeat()
      this.emit({
        title: "Cloak Fetch",
        message: `Downloading CloakBrowser: ${progress}`,
        variant: "info",
        duration: 5_000,
      })
      this.scheduleDownloadProgressHeartbeat(progress)
      return
    }

    if (this.isDownloadFinished(message) || notificationVariant(method, rawMessage) === "error") this.clear()

    this.emit({
      title: "Cloak Fetch",
      message,
      variant: notificationVariant(method, rawMessage),
      duration: 5_000,
    })
  }

  clear() {
    if (this.progressTimer) clearTimeout(this.progressTimer)
    if (this.startTimer) clearTimeout(this.startTimer)
    this.latestProgress = undefined
    this.progressTimer = undefined
    this.startMessage = undefined
    this.startTimer = undefined
    this.startNotified = false
  }

  private downloadProgressText(message: string) {
    return message.match(/Download progress:\s*(.+)$/i)?.[1]
  }

  private downloadSource(message: string) {
    return message.match(/Downloading from\s+(.+)$/i)?.[1]
  }

  private isDownloadStart(message: string) {
    return /not found\.\s*downloading\b/i.test(message) || /^Downloading from\s+/i.test(message) || /^Downloading Chromium\s+/i.test(message)
  }

  private isDownloadFinished(message: string) {
    const lower = message.toLowerCase()
    return lower.includes("download complete") || lower.includes("binary ready")
  }

  private clearDownloadStartHeartbeat() {
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startMessage = undefined
    this.startTimer = undefined
  }

  private scheduleDownloadStartHeartbeat(message: string) {
    this.startMessage = message
    if (this.startTimer) clearTimeout(this.startTimer)

    this.startTimer = setTimeout(() => {
      if (!this.startMessage) return
      this.emit({
        title: "Cloak Fetch",
        message: this.startMessage,
        variant: "info",
        duration: 8_000,
      })
      this.scheduleDownloadStartHeartbeat(this.startMessage)
    }, this.heartbeatMs)
    this.startTimer.unref?.()
  }

  private scheduleDownloadProgressHeartbeat(progress: string) {
    this.latestProgress = progress
    if (this.progressTimer) clearTimeout(this.progressTimer)

    this.progressTimer = setTimeout(() => {
      if (!this.latestProgress) return
      this.emit({
        title: "Cloak Fetch",
        message: `Downloading CloakBrowser: ${this.latestProgress}`,
        variant: "info",
        duration: 5_000,
      })
      this.scheduleDownloadProgressHeartbeat(this.latestProgress)
    }, this.heartbeatMs)
    this.progressTimer.unref?.()
  }

  private emitDownloadStart(message: string) {
    const source = this.downloadSource(message)
    const notification = {
      title: "Cloak Fetch",
      message: source
        ? `Starting CloakBrowser browser binary download from ${source}`
        : "Starting CloakBrowser browser binary download.",
      variant: "info",
      duration: 8_000,
    } satisfies FetchNotification

    if (!this.startNotified || notification.message !== this.startMessage) {
      this.emit(notification)
      this.startNotified = true
    }
    this.scheduleDownloadStartHeartbeat(notification.message)
  }
}
