import { z } from "zod"

export const WebFetchFormatSchema = z.enum(["markdown", "text", "html"])

export const CloakbrowserConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    defaultFormat: WebFetchFormatSchema.default("markdown"),
    maxChars: z.number().int().positive().default(120_000),
    timeout: z
      .object({
        navigationSeconds: z.number().int().positive().max(120).default(30),
        launchMs: z.number().int().positive().default(20_000),
        closeMs: z.number().int().positive().default(2_000),
        extractMs: z.number().int().positive().default(5_000),
        postLoadDelayMs: z.number().int().nonnegative().default(750),
      })
      .default({
        navigationSeconds: 30,
        launchMs: 20_000,
        closeMs: 2_000,
        extractMs: 5_000,
        postLoadDelayMs: 750,
      }),
    cloakbrowser: z
      .object({
        headless: z.boolean().default(true),
        proxy: z
          .union([
            z.string().min(1),
            z.object({
              server: z.string().min(1),
              bypass: z.string().optional(),
              username: z.string().optional(),
              password: z.string().optional(),
            }),
          ])
          .optional(),
        args: z.array(z.string()).default([]),
        stealthArgs: z.boolean().optional(),
        timezone: z.string().optional(),
        locale: z.string().optional(),
        geoip: z.boolean().optional(),
        humanize: z.boolean().optional(),
        humanPreset: z.enum(["default", "careful"]).optional(),
        humanConfig: z.record(z.string(), z.unknown()).optional(),
        launchOptions: z.record(z.string(), z.unknown()).optional(),
      })
      .default({
        headless: true,
        args: [],
      }),
    environment: z
      .object({
        autoUpdate: z.boolean().default(false),
        binaryPath: z.string().min(1).nullable().optional(),
        cacheDir: z.string().min(1).nullable().optional(),
        downloadUrl: z.string().min(1).nullable().optional(),
        skipChecksum: z.boolean().default(false),
      })
      .default({
        autoUpdate: false,
        skipChecksum: false,
      }),
    output: z
      .object({
        includeTitle: z.boolean().default(true),
        includeSource: z.boolean().default(true),
        truncateMarker: z.string().default("[truncated]"),
      })
      .default({
        includeTitle: true,
        includeSource: true,
        truncateMarker: "[truncated]",
      }),
  })
  .default({
    enabled: true,
    defaultFormat: "markdown",
    maxChars: 120_000,
    timeout: {
      navigationSeconds: 30,
      launchMs: 20_000,
      closeMs: 2_000,
      extractMs: 5_000,
      postLoadDelayMs: 750,
    },
    cloakbrowser: {
      headless: true,
      args: [],
    },
    environment: {
      autoUpdate: false,
      skipChecksum: false,
    },
    output: {
      includeTitle: true,
      includeSource: true,
      truncateMarker: "[truncated]",
    },
  })

export type WebFetchFormat = z.infer<typeof WebFetchFormatSchema>
export type CloakbrowserConfig = z.infer<typeof CloakbrowserConfigSchema>
export type CloakbrowserConfigInput = z.input<typeof CloakbrowserConfigSchema>

export const defaultConfig = CloakbrowserConfigSchema.parse({})
