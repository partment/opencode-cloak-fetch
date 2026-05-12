import os from "node:os"
import path from "node:path"
import type { CloakbrowserConfig } from "../schema.js"

export class CloakBrowserEnvironment {
  apply(config: CloakbrowserConfig, autoUpdate = config.environment.autoUpdate) {
    process.env.CLOAKBROWSER_AUTO_UPDATE = autoUpdate ? "true" : "false"
    if (config.environment.binaryPath) process.env.CLOAKBROWSER_BINARY_PATH = config.environment.binaryPath
    if (config.environment.cacheDir) process.env.CLOAKBROWSER_CACHE_DIR = config.environment.cacheDir
    if (config.environment.downloadUrl) process.env.CLOAKBROWSER_DOWNLOAD_URL = config.environment.downloadUrl
    process.env.CLOAKBROWSER_SKIP_CHECKSUM = config.environment.skipChecksum ? "true" : "false"
  }

  withBinaryPath(binaryPath: string) {
    const previous = process.env.CLOAKBROWSER_BINARY_PATH
    process.env.CLOAKBROWSER_BINARY_PATH = binaryPath

    return () => {
      this.setOptionalEnv("CLOAKBROWSER_BINARY_PATH", previous)
    }
  }

  cacheRoot() {
    return process.env.CLOAKBROWSER_CACHE_DIR || path.join(os.homedir(), ".cloakbrowser")
  }

  private setOptionalEnv(name: string, value: string | null | undefined) {
    if (value) {
      process.env[name] = value
      return
    }

    delete process.env[name]
  }
}

export const cloakBrowserEnvironment = new CloakBrowserEnvironment()
