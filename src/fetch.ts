import { launch } from "cloakbrowser/puppeteer"
import type { Browser } from "puppeteer-core"
import { cloakBrowserBinaryPreparer } from "./cloakbrowser/binary-preparer.js"
import { cloakBrowserConsoleBridge } from "./cloakbrowser/console-bridge.js"
import { cloakBrowserEnvironment } from "./cloakbrowser/environment.js"
import { waitForChallengeCompletion } from "./challenges.js"
import type { FetchOptions } from "./fetch-events.js"
import { FetchOutputRenderer } from "./fetch-output.js"
import type { CloakbrowserConfig, WebFetchFormat } from "./schema.js"
import { sleep, withTimeout } from "./timing.js"

export type FetchArgs = {
  url: string
  format?: WebFetchFormat
  timeout?: number
}

export async function prepareCloakBrowser(config: CloakbrowserConfig, options: FetchOptions = {}) {
  return cloakBrowserBinaryPreparer.prepare(config, options)
}

export async function fetchWithCloakBrowser(args: FetchArgs, config: CloakbrowserConfig, options: FetchOptions = {}) {
  if (!config.enabled) throw new Error("opencode-cloak-fetch webfetch is disabled by cloakbrowser config")

  const binaryPath = await prepareCloakBrowser(config, options)
  if (!binaryPath) throw new Error("opencode-cloak-fetch webfetch is disabled by cloakbrowser config")

  const format = args.format ?? config.defaultFormat
  const timeoutMs = (args.timeout ?? config.timeout.navigationSeconds) * 1000
  const renderer = new FetchOutputRenderer(config)
  let browser: Browser | undefined

  const restoreBinaryPath = cloakBrowserEnvironment.withBinaryPath(binaryPath)
  const restoreConsole = cloakBrowserConsoleBridge.intercept(options)
  try {
    browser = await withTimeout(
      launch({
        headless: config.cloakbrowser.headless,
        proxy: config.cloakbrowser.proxy,
        args: config.cloakbrowser.args,
        stealthArgs: config.cloakbrowser.stealthArgs,
        timezone: config.cloakbrowser.timezone,
        locale: config.cloakbrowser.locale,
        geoip: config.cloakbrowser.geoip,
        humanize: config.cloakbrowser.humanize,
        humanPreset: config.cloakbrowser.humanPreset,
        humanConfig: config.cloakbrowser.humanConfig,
        launchOptions: {
          ...config.cloakbrowser.launchOptions,
          timeout: Math.min(config.timeout.launchMs, timeoutMs),
        },
      }),
      Math.min(config.timeout.launchMs + 5_000, timeoutMs + 5_000),
      "browser launch",
    )
  } finally {
    restoreConsole()
    restoreBinaryPath()
  }

  try {
    const page = await browser.newPage()
    page.setDefaultNavigationTimeout(timeoutMs)
    page.setDefaultTimeout(Math.min(config.timeout.extractMs, timeoutMs))

    const navigationResponse = await withTimeout(
      page.goto(args.url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      }),
      timeoutMs,
      "page navigation",
    )

    await waitForChallengeCompletion(page, config, options, { navigationResponse })

    if (config.timeout.postLoadDelayMs > 0) await sleep(config.timeout.postLoadDelayMs)

    const finalUrl = page.url()
    const title = await page.title().catch(() => "")
    if (format === "html") {
      return renderer.truncate(await withTimeout(page.content(), config.timeout.extractMs, "html extraction"))
    }

    const text = await withTimeout(
      page.evaluate(() => document.body?.innerText || document.documentElement?.innerText || ""),
      config.timeout.extractMs,
      "text extraction",
    ).catch(() => "")
    return renderer.truncate(renderer.renderText(format, title, finalUrl, text))
  } finally {
    await withTimeout(browser.close(), config.timeout.closeMs, "browser close").catch(() => undefined)
  }
}

export type { FetchLogEntry, FetchNotification, FetchOptions } from "./fetch-events.js"
