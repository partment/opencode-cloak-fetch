import { describe, expect, test } from "vitest"
import {
  detectChallengeStrategy,
  waitForChallengeCompletion,
  type ChallengeNavigation,
  type ChallengePage,
  type ChallengePageState,
} from "../src/challenges.js"
import type { FetchLogEntry } from "../src/fetch-events.js"
import { CloakbrowserConfigSchema } from "../src/schema.js"

function pageState(input: Partial<ChallengePageState>): ChallengePageState {
  return {
    url: "https://example.com/",
    responseHeaders: {},
    resourceUrls: [],
    elementMarkers: [],
    cookieNames: [],
    ...input,
  }
}

function navigationResponse(headers: Record<string, string>, url = "https://example.com/"): ChallengeNavigation {
  return {
    headers: () => headers,
    url: () => url,
  } as ChallengeNavigation
}

function fakePage(states: ChallengePageState[], responses: Array<ChallengeNavigation | undefined> = []) {
  let index = 0
  let evaluateCalls = 0
  let waitForNavigationCalls = 0

  const page = {
    url: () => states[index]?.url ?? "about:blank",
    evaluate: async () => {
      evaluateCalls += 1
      const state = states[index] ?? pageState({})
      return {
        resourceUrls: state.resourceUrls,
        elementMarkers: state.elementMarkers,
        cookieNames: state.cookieNames,
      }
    },
    waitForNavigation: async () => {
      const response = responses[waitForNavigationCalls]
      waitForNavigationCalls += 1
      index = Math.min(index + 1, states.length - 1)
      return response ?? null
    },
  } as unknown as ChallengePage

  return {
    page,
    get evaluateCalls() {
      return evaluateCalls
    },
    get waitForNavigationCalls() {
      return waitForNavigationCalls
    },
  }
}

function config(challengeWaitMs: number) {
  return CloakbrowserConfigSchema.parse({
    timeout: {
      challengeWaitMs,
    },
  })
}

describe("challenge strategies", () => {
  test.each([
    [
      "cloudflare-challenge",
      pageState({
        resourceUrls: ["https://example.com/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"],
      }),
    ],
    [
      "cloudflare-challenge",
      pageState({
        responseHeaders: { "cf-mitigated": "challenge" },
      }),
    ],
    [
      "ddos-guard-challenge",
      pageState({
        resourceUrls: ["https://check.ddos-guard.net/check.js"],
      }),
    ],
    [
      "datadome-challenge",
      pageState({
        resourceUrls: ["https://geo.captcha-delivery.com/captcha/"],
      }),
    ],
    [
      "akamai-bot-manager-challenge",
      pageState({
        resourceUrls: ["https://example.com/akam/13/bm-verify"],
      }),
    ],
    [
      "imperva-incapsula-challenge",
      pageState({
        resourceUrls: ["https://example.com/_Incapsula_Resource"],
      }),
    ],
    [
      "perimeterx-challenge",
      pageState({
        elementMarkers: ["id=px-captcha"],
      }),
    ],
  ])("detects %s from technical fingerprints", (expectedName, state) => {
    const detection = detectChallengeStrategy(state)

    expect(detection?.strategy).toBe(expectedName)
    expect(detection?.reason).toBeTruthy()
  })

  test("does not classify ordinary Turnstile widgets as transient challenge pages", () => {
    const detection = detectChallengeStrategy(
      pageState({
        resourceUrls: ["https://challenges.cloudflare.com/turnstile/v0/api.js"],
        elementMarkers: ["class=cf-turnstile", "data-sitekey=1x00000000000000000000AA"],
      }),
    )

    expect(detection).toBeUndefined()
  })

  test("does not use visible-language content as a detection signal", () => {
    const detection = detectChallengeStrategy(
      pageState({
        resourceUrls: ["https://example.com/assets/app.js"],
        elementMarkers: ["id=main", "class=content"],
        cookieNames: ["session"],
      }),
    )

    expect(detection).toBeUndefined()
  })

  test.each([
    [
      "REI-like Akamai telemetry",
      pageState({
        resourceUrls: ["https://www.rei.com/akam/13/pixel"],
        cookieNames: ["_abck", "bm_sz"],
      }),
    ],
    [
      "DataDome cookie",
      pageState({
        cookieNames: ["datadome"],
      }),
    ],
    [
      "Imperva cookies",
      pageState({
        cookieNames: ["visid_incap_123", "incap_ses_456"],
      }),
    ],
    [
      "PerimeterX telemetry",
      pageState({
        resourceUrls: ["https://collector-px.example.com/api/v2/collector"],
        cookieNames: ["_px3"],
      }),
    ],
  ])("does not detect low-confidence %s markers", (_name, state) => {
    expect(detectChallengeStrategy(state)).toBeUndefined()
  })
})

describe("waitForChallengeCompletion", () => {
  test("waits until a detected technical marker disappears", async () => {
    const fixture = fakePage([
      pageState({
        resourceUrls: ["https://example.com/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"],
      }),
      pageState({
        resourceUrls: ["https://example.com/assets/app.js"],
      }),
    ])
    const logs: FetchLogEntry[] = []

    const result = await waitForChallengeCompletion(
      fixture.page,
      config(50),
      { log: (entry) => logs.push(entry) },
      { runtime: { pollMs: 1, sleep: async () => undefined } },
    )

    expect(result.detected).toBe(true)
    expect(result.resolved).toBe(true)
    expect(result.strategy).toBe("cloudflare-challenge")
    expect(result.reason).toBe("Cloudflare challenge platform resource")
    expect(fixture.waitForNavigationCalls).toBe(1)
    expect(logs.map((entry) => entry.level)).toEqual(["info", "info"])
  })

  test("can detect an initial challenge from navigation response headers", async () => {
    const fixture = fakePage([
      pageState({
        resourceUrls: ["https://example.com/assets/app.js"],
      }),
      pageState({
        resourceUrls: ["https://example.com/assets/app.js"],
      }),
    ])

    const result = await waitForChallengeCompletion(
      fixture.page,
      config(50),
      {},
      {
        navigationResponse: navigationResponse({ "cf-mitigated": "challenge" }),
        runtime: { pollMs: 1, sleep: async () => undefined },
      },
    )

    expect(result.detected).toBe(true)
    expect(result.resolved).toBe(true)
    expect(result.reason).toBe("response header cf-mitigated")
  })

  test("stops waiting after a high-confidence marker disappears and low-confidence cookies remain", async () => {
    const fixture = fakePage([
      pageState({
        resourceUrls: ["https://example.com/akam/13/bm-verify"],
        cookieNames: ["_abck", "bm_sz"],
      }),
      pageState({
        resourceUrls: ["https://example.com/akam/13/pixel"],
        cookieNames: ["_abck", "bm_sz"],
      }),
    ])

    const result = await waitForChallengeCompletion(
      fixture.page,
      config(50),
      {},
      { runtime: { pollMs: 1, sleep: async () => undefined } },
    )

    expect(result.detected).toBe(true)
    expect(result.resolved).toBe(true)
    expect(result.strategy).toBe("akamai-bot-manager-challenge")
    expect(fixture.waitForNavigationCalls).toBe(1)
  })

  test("does not wait when no challenge is detected", async () => {
    const fixture = fakePage([pageState({ resourceUrls: ["https://example.com/assets/app.js"] })])

    const result = await waitForChallengeCompletion(
      fixture.page,
      config(50),
      {},
      { runtime: { pollMs: 1, sleep: async () => undefined } },
    )

    expect(result.detected).toBe(false)
    expect(result.resolved).toBe(false)
    expect(fixture.evaluateCalls).toBe(1)
    expect(fixture.waitForNavigationCalls).toBe(0)
  })

  test("skips detection and waiting when challenge waiting is disabled", async () => {
    const fixture = fakePage([
      pageState({
        resourceUrls: ["https://example.com/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"],
      }),
    ])

    const result = await waitForChallengeCompletion(fixture.page, config(0))

    expect(result.detected).toBe(false)
    expect(fixture.evaluateCalls).toBe(0)
    expect(fixture.waitForNavigationCalls).toBe(0)
  })
})
