# opencode-cloak-fetch

OpenCode plugin that replaces the built-in `webfetch` tool with a CloakBrowser-backed fetcher.

Use it when pages need JavaScript execution, Chromium rendering, stealth browser behavior, proxy settings, locale/timezone controls, or other browser-level options that the built-in fetcher cannot provide.

## Installation

Add the npm package to your OpenCode config.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-cloak-fetch"]
}
```

OpenCode loads npm plugins at startup. No additional tool configuration is required. The plugin registers a tool named `webfetch`, which takes precedence over the built-in tool with the same name.

For a local checkout during development, use a file URL instead.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///path/to/opencode-cloak-fetch"]
}
```

## First Startup

On startup, the plugin starts preparing the CloakBrowser browser binary in the background. The first `webfetch` call waits for that preparation if it is still running.

If the browser binary is not already available, CloakBrowser downloads it to its cache directory. Download and update status is shown through OpenCode toast notifications titled `Cloak Fetch`. CloakBrowser console output is written to the OpenCode app log instead of the tool output area.

Only one OpenCode process prepares the browser binary at a time. Other processes wait for the same preparation lock to finish.

## Configuration Files

Create `cloakfetch.json` or `cloakfetch.jsonc` in any supported location. Later layers override earlier layers. Within the same directory, `cloakfetch.jsonc` is read after `cloakfetch.json` and can override it.

Read order:

1. Built-in defaults.
2. Global OpenCode config directory: `cloakfetch.json`, then `cloakfetch.jsonc`.
3. Directory from `OPENCODE_CONFIG_DIR`: `cloakfetch.json`, then `cloakfetch.jsonc`.
4. Nearest project `.opencode` directory found by walking upward from the current directory: `cloakfetch.json`, then `cloakfetch.jsonc`.

Global OpenCode config directory:

- `$XDG_CONFIG_HOME/opencode`, when `XDG_CONFIG_HOME` is set.
- `~/.config/opencode`, when `XDG_CONFIG_HOME` is not set.

If neither `cloakfetch.json` nor `cloakfetch.jsonc` exists in the global OpenCode config directory, the plugin creates an empty `cloakfetch.jsonc` file on first load.

## Example Configuration

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/partment/opencode-cloak-fetch/main/configSchema.json",
  "enabled": true,
  "defaultFormat": "markdown",
  "maxChars": 120000,
  "timeout": {
    "navigationSeconds": 30,
    "launchMs": 20000,
    "closeMs": 2000,
    "extractMs": 5000,
    "postLoadDelayMs": 750
  },
  "cloakbrowser": {
    "headless": true,
    "proxy": {
      "server": "socks5://host:1080",
      "username": "user",
      "password": "pass"
    },
    "args": ["--disable-dev-shm-usage"],
    "stealthArgs": true,
    "timezone": "Asia/Taipei",
    "locale": "zh-TW",
    "geoip": false,
    "humanize": false,
    "humanPreset": "default",
    "humanConfig": {},
    "launchOptions": {}
  },
  "environment": {
    "autoUpdate": false,
    "binaryPath": null,
    "cacheDir": null,
    "downloadUrl": null,
    "skipChecksum": false
  },
  "output": {
    "includeTitle": true,
    "includeSource": true,
    "truncateMarker": "[truncated]"
  }
}
```

## Configuration Reference

### Top-Level Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Enables or disables this plugin's `webfetch` implementation. |
| `defaultFormat` | string | `"markdown"` | Output format used when the tool call does not provide `format`. Allowed: `markdown`, `text`, `html`. |
| `maxChars` | integer | `120000` | Maximum output size before truncation. `(>=1)` |
| `timeout` | object | see below | Timeout controls for browser launch, navigation, extraction, and close. |
| `cloakbrowser` | object | see below | Options passed to `cloakbrowser/puppeteer` launch. |
| `environment` | object | see below | Environment variables used by CloakBrowser binary management. |
| `output` | object | see below | Formatting controls for text and markdown output. |

### `timeout`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `navigationSeconds` | integer | `30` | Page navigation timeout in seconds. The tool argument `timeout` overrides this per call. `(1-120)` |
| `launchMs` | integer | `20000` | Browser launch timeout in milliseconds. `(>=1)` |
| `closeMs` | integer | `2000` | Browser close timeout in milliseconds. Close errors are ignored after this timeout. `(>=1)` |
| `extractMs` | integer | `5000` | Timeout for HTML or text extraction after navigation. `(>=1)` |
| `postLoadDelayMs` | integer | `750` | Delay after `domcontentloaded` before extracting content. `(>=0)` |

### `cloakbrowser`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `headless` | `boolean` | `true` | Runs Chromium in headless mode. |
| `proxy` | string or object | unset | Proxy configuration passed to CloakBrowser. Object form supports `server`, `bypass`, `username`, and `password`. |
| `args` | array | `[]` | Additional Chromium arguments. Array of strings. |
| `stealthArgs` | `boolean` | unset | Enables CloakBrowser stealth argument handling when set. |
| `timezone` | `string` | unset | Browser timezone, such as `Asia/Taipei`. |
| `locale` | `string` | unset | Browser locale, such as `zh-TW` or `en-US`. |
| `geoip` | `boolean` | unset | Enables CloakBrowser geo-IP behavior when supported by CloakBrowser. |
| `humanize` | `boolean` | unset | Enables CloakBrowser humanization behavior when supported by CloakBrowser. |
| `humanPreset` | string | unset | Humanization preset. Allowed: `default`, `careful`. |
| `humanConfig` | object | unset | Additional humanization settings passed to CloakBrowser. |
| `launchOptions` | object | unset | Extra Puppeteer launch options. The plugin still sets a bounded launch timeout. |

`proxy` object form:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `server` | `string` | yes | Proxy server URL. |
| `bypass` | `string` | no | Proxy bypass list. |
| `username` | `string` | no | Proxy username. |
| `password` | `string` | no | Proxy password. |

### `environment`

These fields map to CloakBrowser environment variables before binary preparation.

| Field | Type | Default | Environment Variable | Description |
| --- | --- | --- | --- | --- |
| `autoUpdate` | `boolean` | `false` | `CLOAKBROWSER_AUTO_UPDATE` | Allows update checks when `binaryPath` and `downloadUrl` are not set. |
| `binaryPath` | string or null | unset | `CLOAKBROWSER_BINARY_PATH` | Uses an existing browser binary instead of the cached CloakBrowser binary. String value must be non-empty. |
| `cacheDir` | string or null | unset | `CLOAKBROWSER_CACHE_DIR` | CloakBrowser cache directory. Also stores the plugin's preparation lock. String value must be non-empty. |
| `downloadUrl` | string or null | unset | `CLOAKBROWSER_DOWNLOAD_URL` | Custom browser binary download URL. String value must be non-empty. |
| `skipChecksum` | `boolean` | `false` | `CLOAKBROWSER_SKIP_CHECKSUM` | Skips checksum verification when CloakBrowser supports it. |

### `output`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `includeTitle` | `boolean` | `true` | Adds the page title to `markdown` and `text` output. |
| `includeSource` | `boolean` | `true` | Adds the final page URL to `markdown` and `text` output. |
| `truncateMarker` | `string` | `"[truncated]"` | Marker appended after truncated output. |

## Tool Arguments

The registered `webfetch` tool accepts:

| Argument | Type | Description |
| --- | --- | --- |
| `url` | string | Page URL to fetch. Must be a valid URL. |
| `format` | string | Optional output format. Defaults to `defaultFormat`. Allowed: `markdown`, `text`, `html`. |
| `timeout` | integer | Optional per-call navigation timeout in seconds. `(1-120)` |

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```
