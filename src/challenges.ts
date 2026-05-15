import type { HTTPResponse, Page } from "puppeteer-core"
import type { FetchLogEntry, FetchOptions } from "./fetch-events.js"
import type { CloakbrowserConfig } from "./schema.js"
import { sleep as defaultSleep } from "./timing.js"

const defaultPollMs = 1_000
const maxResourceUrls = 500
const maxElementMarkers = 1_000
const maxMarkerChars = 300

export type ChallengePageState = {
  url: string
  responseUrl?: string
  responseHeaders: Record<string, string>
  resourceUrls: string[]
  elementMarkers: string[]
  cookieNames: string[]
}

export type ChallengeDetection = {
  strategy: string
  reason: string
}

export type ChallengeStrategy = {
  name: string
  detect: (state: ChallengePageState) => ChallengeDetection | undefined
}

export type ChallengeWaitResult = {
  detected: boolean
  strategy?: string
  reason?: string
  resolved: boolean
  timedOut: boolean
  elapsedMs: number
  finalState?: ChallengePageState
}

export type ChallengePage = Pick<Page, "evaluate" | "url" | "waitForNavigation">
export type ChallengeNavigation = Pick<HTTPResponse, "headers" | "url">

export type ChallengeWaitRuntime = {
  now?: () => number
  pollMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type ChallengeWaitOptions = {
  navigationResponse?: ChallengeNavigation | null
  runtime?: ChallengeWaitRuntime
}

type ChallengeRule = {
  reason: string
  pattern: RegExp
  score: number
}

type ChallengeRuleSet = {
  name: string
  minScore: number
  rules: ChallengeRule[]
}

const cloudflareRules: ChallengeRule[] = [
  { reason: "response header cf-mitigated", pattern: /^header:cf-mitigated=challenge$/i, score: 10 },
  { reason: "Cloudflare challenge platform resource", pattern: /\/cdn-cgi\/challenge-platform/i, score: 10 },
  { reason: "Cloudflare challenge token marker", pattern: /cf_chl_/i, score: 10 },
  { reason: "Cloudflare browser verification marker", pattern: /cf-browser-verification/i, score: 10 },
  { reason: "Cloudflare challenge frame", pattern: /challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform/i, score: 10 },
]

const ddosGuardRules: ChallengeRule[] = [
  { reason: "DDoS-Guard check host", pattern: /check\.ddos-guard\.net/i, score: 10 },
  { reason: "DDoS-Guard cookie or marker", pattern: /(?:^|[:=])__ddg/i, score: 1 },
]

const datadomeRules: ChallengeRule[] = [
  { reason: "DataDome challenge host", pattern: /captcha-delivery\.com/i, score: 10 },
  { reason: "DataDome cookie or marker", pattern: /(?:^|[:=])datadome/i, score: 1 },
  { reason: "DataDome endpoint", pattern: /datadome\.co/i, score: 10 },
]

const akamaiRules: ChallengeRule[] = [
  { reason: "Akamai _abck cookie", pattern: /^cookie:_abck$/i, score: 1 },
  { reason: "Akamai bm_sz cookie", pattern: /^cookie:bm_sz$/i, score: 1 },
  { reason: "Akamai verification marker", pattern: /bm-verify/i, score: 10 },
  { reason: "Akamai sensor marker", pattern: /sensor_data/i, score: 2 },
  { reason: "Akamai telemetry path", pattern: /\/akam\//i, score: 1 },
]

const impervaRules: ChallengeRule[] = [
  { reason: "Imperva resource path", pattern: /_Incapsula_Resource/i, score: 10 },
  { reason: "Imperva visid_incap cookie", pattern: /^cookie:visid_incap/i, score: 1 },
  { reason: "Imperva incap_ses cookie", pattern: /^cookie:incap_ses/i, score: 1 },
]

const perimeterXRules: ChallengeRule[] = [
  { reason: "PerimeterX captcha marker", pattern: /px-captcha/i, score: 10 },
  { reason: "PerimeterX cookie", pattern: /^cookie:_px/i, score: 1 },
  { reason: "PerimeterX collector endpoint", pattern: /collector-px/i, score: 2 },
]

const challengeRuleSets: ChallengeRuleSet[] = [
  { name: "cloudflare-challenge", minScore: 10, rules: cloudflareRules },
  { name: "ddos-guard-challenge", minScore: 10, rules: ddosGuardRules },
  { name: "datadome-challenge", minScore: 10, rules: datadomeRules },
  { name: "akamai-bot-manager-challenge", minScore: 10, rules: akamaiRules },
  { name: "imperva-incapsula-challenge", minScore: 10, rules: impervaRules },
  { name: "perimeterx-challenge", minScore: 10, rules: perimeterXRules },
]

export const challengeStrategies: ChallengeStrategy[] = challengeRuleSets.map(createRuleStrategy)

export function detectChallengeStrategy(state: ChallengePageState, strategies = challengeStrategies) {
  for (const strategy of strategies) {
    const detection = strategy.detect(state)
    if (detection) return detection
  }

  return undefined
}

export async function extractChallengePageState(
  page: ChallengePage,
  navigationResponse?: ChallengeNavigation | null,
): Promise<ChallengePageState> {
  const url = page.url()
  const documentState = await page
    .evaluate((limits) => {
      const resourceUrls = uniqueStrings([
        ...Array.from(document.scripts, (script) => script.src),
        ...Array.from(document.querySelectorAll("iframe[src]"), (element) => element.getAttribute("src")),
        ...Array.from(document.querySelectorAll("form[action]"), (element) => element.getAttribute("action")),
        ...Array.from(document.querySelectorAll("link[href]"), (element) => element.getAttribute("href")),
        ...Array.from(document.querySelectorAll("object[data]"), (element) => element.getAttribute("data")),
        ...Array.from(document.querySelectorAll("embed[src]"), (element) => element.getAttribute("src")),
        ...extractMetaRefreshUrls(),
      ]).slice(0, limits.maxResourceUrls)

      const elementMarkers = extractElementMarkers(limits.maxElementMarkers, limits.maxMarkerChars)
      const cookieNames = extractCookieNames()

      return { resourceUrls, elementMarkers, cookieNames }

      function extractMetaRefreshUrls() {
        return Array.from(document.querySelectorAll('meta[http-equiv="refresh" i]'), (element) => {
          const content = element.getAttribute("content") ?? ""
          return content.match(/url\s*=\s*([^;]+)/i)?.[1]?.trim()
        })
      }

      function extractElementMarkers(maxMarkers: number, maxChars: number) {
        const markers: string[] = []
        const elements = Array.from(document.querySelectorAll("[id], [class], [name], [data-sitekey], [data-action]"))

        for (const element of elements) {
          if (markers.length >= maxMarkers) break
          for (const attribute of Array.from(element.attributes)) {
            if (markers.length >= maxMarkers) break
            if (!isMarkerAttribute(attribute.name)) continue
            markers.push(`${attribute.name}=${attribute.value}`.slice(0, maxChars))
          }
        }

        return uniqueStrings(markers)
      }

      function isMarkerAttribute(name: string) {
        return name === "id" || name === "class" || name === "name" || name.startsWith("data-")
      }

      function extractCookieNames() {
        try {
          return uniqueStrings(
            document.cookie
              .split(";")
              .map((cookie) => cookie.split("=")[0]?.trim())
              .filter(Boolean),
          )
        } catch {
          return []
        }
      }

      function uniqueStrings(values: Array<string | null | undefined>) {
        return [...new Set(values.filter((value): value is string => Boolean(value)))]
      }
    }, { maxResourceUrls, maxElementMarkers, maxMarkerChars })
    .catch(() => ({
      resourceUrls: [],
      elementMarkers: [],
      cookieNames: [],
    }))

  return {
    url,
    responseUrl: navigationResponse?.url(),
    responseHeaders: normalizeResponseHeaders(navigationResponse),
    resourceUrls: documentState.resourceUrls,
    elementMarkers: documentState.elementMarkers,
    cookieNames: documentState.cookieNames,
  }
}

export async function waitForChallengeCompletion(
  page: ChallengePage,
  config: CloakbrowserConfig,
  options: FetchOptions = {},
  waitOptions: ChallengeWaitOptions = {},
): Promise<ChallengeWaitResult> {
  const runtime = waitOptions.runtime ?? {}
  const now = runtime.now ?? Date.now
  const startedAt = now()
  if (config.timeout.challengeWaitMs <= 0) {
    return { detected: false, resolved: false, timedOut: false, elapsedMs: 0 }
  }

  let state = await extractChallengePageState(page, waitOptions.navigationResponse)
  const initialDetection = detectChallengeStrategy(state)
  if (!initialDetection) {
    return { detected: false, resolved: false, timedOut: false, elapsedMs: now() - startedAt }
  }

  emitLog(options, {
    level: "info",
    message: `Detected ${initialDetection.strategy}; waiting for challenge completion`,
    extra: {
      reason: initialDetection.reason,
      url: state.url,
      timeoutMs: config.timeout.challengeWaitMs,
    },
  })

  const sleep = runtime.sleep ?? defaultSleep
  const pollMs = Math.max(1, runtime.pollMs ?? defaultPollMs)
  const deadline = now() + config.timeout.challengeWaitMs

  while (now() < deadline) {
    const remainingMs = deadline - now()
    const navigationResponse = await waitForNavigationOrDelay(page, Math.min(pollMs, remainingMs), sleep)

    state = await extractChallengePageState(page, navigationResponse)
    const currentDetection = detectChallengeStrategy(state)
    if (!currentDetection) {
      const elapsedMs = now() - startedAt
      emitLog(options, {
        level: "info",
        message: `Challenge ${initialDetection.strategy} completed`,
        extra: {
          url: state.url,
          elapsedMs,
        },
      })
      return {
        detected: true,
        strategy: initialDetection.strategy,
        reason: initialDetection.reason,
        resolved: true,
        timedOut: false,
        elapsedMs,
        finalState: state,
      }
    }
  }

  const elapsedMs = now() - startedAt
  emitLog(options, {
    level: "warn",
    message: `Challenge ${initialDetection.strategy} did not complete before timeout`,
    extra: {
      reason: initialDetection.reason,
      url: state.url,
      elapsedMs,
    },
  })

  return {
    detected: true,
    strategy: initialDetection.strategy,
    reason: initialDetection.reason,
    resolved: false,
    timedOut: true,
    elapsedMs,
    finalState: state,
  }
}

function createRuleStrategy(ruleSet: ChallengeRuleSet): ChallengeStrategy {
  return {
    name: ruleSet.name,
    detect: (state) => {
      const matchedRules = findMatchingRules(state, ruleSet.rules)
      const score = matchedRules.reduce((total, rule) => total + rule.score, 0)
      if (score < ruleSet.minScore) return undefined
      return { strategy: ruleSet.name, reason: matchedRules.map((rule) => rule.reason).join(", ") }
    },
  }
}

function findMatchingRules(state: ChallengePageState, rules: ChallengeRule[]) {
  const values = technicalValues(state)
  return rules.filter((rule) => values.some((value) => rule.pattern.test(value)))
}

function technicalValues(state: ChallengePageState) {
  return [
    `url:${state.url}`,
    state.responseUrl ? `response-url:${state.responseUrl}` : undefined,
    ...state.resourceUrls.map((value) => `resource:${value}`),
    ...state.elementMarkers.map((value) => `element:${value}`),
    ...state.cookieNames.map((value) => `cookie:${value}`),
    ...Object.entries(state.responseHeaders).map(([name, value]) => `header:${name}=${value}`),
  ].filter((value): value is string => Boolean(value))
}

function normalizeResponseHeaders(response?: ChallengeNavigation | null) {
  if (!response) return {}

  return Object.fromEntries(Object.entries(response.headers()).map(([name, value]) => [name.toLowerCase(), value]))
}

async function waitForNavigationOrDelay(
  page: ChallengePage,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
) {
  return Promise.race([
    page
      .waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      })
      .catch(() => undefined),
    sleep(timeoutMs).then(() => undefined),
  ])
}

function emitLog(options: FetchOptions, entry: FetchLogEntry) {
  void Promise.resolve(options.log?.(entry)).catch(() => undefined)
}
