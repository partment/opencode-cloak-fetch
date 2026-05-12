import { describe, expect, test } from "vitest"
import { FetchOutputRenderer } from "../src/fetch-output.js"
import { CloakbrowserConfigSchema } from "../src/schema.js"

describe("FetchOutputRenderer", () => {
  test("renders markdown with title and source", () => {
    const renderer = new FetchOutputRenderer(CloakbrowserConfigSchema.parse({}))

    expect(renderer.renderText("markdown", "Example", "https://example.com/page", "Body text")).toBe(
      "# Example\n\nSource: https://example.com/page\n\nBody text",
    )
  })

  test("renders plain text without disabled metadata", () => {
    const renderer = new FetchOutputRenderer(
      CloakbrowserConfigSchema.parse({
        output: {
          includeTitle: false,
          includeSource: false,
        },
      }),
    )

    expect(renderer.renderText("text", "Example", "https://example.com/page", "Body text")).toBe("Body text")
  })

  test("truncates oversized output with the configured marker", () => {
    const renderer = new FetchOutputRenderer(
      CloakbrowserConfigSchema.parse({
        maxChars: 5,
        output: {
          truncateMarker: "[cut]",
        },
      }),
    )

    expect(renderer.truncate("abcdefg")).toBe("abcde\n\n[cut]")
  })
})
