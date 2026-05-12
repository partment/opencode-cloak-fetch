import type { CloakbrowserConfig, WebFetchFormat } from "./schema.js"

export class FetchOutputRenderer {
  constructor(private readonly config: CloakbrowserConfig) {}

  truncate(output: string) {
    if (output.length <= this.config.maxChars) return output
    return `${output.slice(0, this.config.maxChars)}\n\n${this.config.output.truncateMarker}`
  }

  renderText(format: WebFetchFormat, title: string, finalUrl: string, text: string) {
    if (format === "text") {
      return [
        this.config.output.includeTitle ? title || finalUrl : undefined,
        this.config.output.includeSource ? finalUrl : undefined,
        text,
      ]
        .filter(Boolean)
        .join("\n")
    }

    const header = this.config.output.includeTitle ? `# ${title || finalUrl}\n\n` : ""
    const source = this.config.output.includeSource ? `Source: ${finalUrl}\n\n` : ""
    return `${header}${source}${text}`
  }
}
