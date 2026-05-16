import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { fetchWithCloakBrowser, prepareCloakBrowser, type FetchLogEntry, type FetchNotification } from "./fetch.js"
import { loadConfig } from "./config.js"
import { webFetchFormats } from "./schema.js"

export const server: Plugin = async ({ client, directory, worktree }) => {
  function notifyIn(targetDirectory: string) {
    return (notification: FetchNotification) => {
      void client.tui
        .showToast({
          query: { directory: targetDirectory },
          body: notification,
        })
        .catch(() => undefined)
    }
  }

  function logIn(targetDirectory: string) {
    return (entry: FetchLogEntry) => {
      void client.app
        .log({
          query: { directory: targetDirectory },
          body: {
            service: "opencode-cloak-fetch",
            level: entry.level,
            message: entry.message,
            extra: entry.extra,
          },
        })
        .catch(() => undefined)
    }
  }

  const notify = notifyIn(directory)
  const log = logIn(directory)

  void loadConfig({ directory, worktree })
    .then((config) => prepareCloakBrowser(config, { notify, log }))
    .catch((error) => {
      notify({
        title: "Cloak Fetch",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
        duration: 8_000,
      })
    })

  return {
    tool: {
      webfetch: tool({
        description:
          "Fetch a web page using CloakBrowser stealth Chromium. Use this for JavaScript-rendered or anti-bot protected pages.",
        args: {
          url: tool.schema.string().url().describe("URL to fetch"),
          format: tool.schema.enum(webFetchFormats).optional().describe("Output format"),
          timeout: tool.schema.number().int().positive().max(120).optional().describe("Timeout in seconds"),
        },
        async execute(args, context) {
          const config = await loadConfig({ directory: context.directory, worktree: context.worktree })
          return fetchWithCloakBrowser(args, config, { notify: notifyIn(context.directory), log: logIn(context.directory) })
        },
      }),
    },
  }
}

export default {
  id: "opencode-cloak-fetch",
  server,
}

export { fetchWithCloakBrowser, loadConfig, prepareCloakBrowser }
export type { FetchArgs, FetchLogEntry, FetchNotification, FetchOptions } from "./fetch.js"
export type { CloakbrowserConfig } from "./schema.js"
