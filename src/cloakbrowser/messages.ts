import type { FetchLogEntry, FetchNotification } from "../fetch-events.js"

export const cloakBrowserConsoleMethods = ["log", "warn", "error"] as const
export type CloakBrowserConsoleMethod = (typeof cloakBrowserConsoleMethods)[number]

export function stringifyConsoleArg(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.stack || value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export function isCloakbrowserMessage(message: string) {
  const lower = message.toLowerCase()
  return lower.includes("[cloakbrowser]") || lower.includes("cloakbrowser") || lower.includes("cloakhq")
}

export function isPrefixedCloakbrowserMessage(message: string) {
  return /^\[cloakbrowser\]\s*/i.test(message)
}

export function cleanCloakbrowserMessage(rawMessage: string) {
  return rawMessage.replace(/^\[cloakbrowser\]\s*/i, "").trim()
}

export function notificationVariant(method: CloakBrowserConsoleMethod, message: string): FetchNotification["variant"] {
  const lower = message.toLowerCase()
  if (lower.includes("failed") || lower.includes("error") || lower.includes("not found at expected path")) return "error"
  if (method === "warn" || lower.includes("skipping") || lower.includes("update available")) return "warning"
  if (lower.includes("complete") || lower.includes("ready") || lower.includes("verified")) return "success"
  return "info"
}

export function logLevel(method: CloakBrowserConsoleMethod): FetchLogEntry["level"] {
  if (method === "warn") return "warn"
  if (method === "error") return "error"
  return "info"
}
