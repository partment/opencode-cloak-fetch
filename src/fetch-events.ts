export type FetchNotification = {
  title: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration?: number
}

export type FetchLogEntry = {
  level: "debug" | "info" | "warn" | "error"
  message: string
  extra?: Record<string, unknown>
}

export type FetchOptions = {
  notify?: (notification: FetchNotification) => void | Promise<void>
  log?: (entry: FetchLogEntry) => void | Promise<void>
}

export type NotificationHandler = NonNullable<FetchOptions["notify"]>
export type LogHandler = NonNullable<FetchOptions["log"]>
