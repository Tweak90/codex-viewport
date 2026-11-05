# Configuration

[Deutsch](Konfiguration.md) · [English home](en-Home.md)

The web container connects exclusively to an external Codex API over WebSocket. `.env.example` contains neutral examples. For Docker, use `--env-file`; Compose reads `.env`.

## Application variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `CODEX_WS_URL` | External Codex API address, starting with `ws://` or `wss://` | Empty; set in ENV or Settings to connect |
| `CODEX_API_TOKEN` | Bearer token if required by that API | Empty |
| `HOST_LABEL` | Codex host name displayed in the UI | `Codex-Host` |
| `CODEX_PROJECTS_ROOT` | Base directory for new projects on the Codex host | Derived from Codex metadata, ending in `codex-projects` |
| `CODEX_WEB_LANGUAGE` | Language without a saved override | `en`; alternatively `de` |
| `CODEX_SEND_WITH` | Send key without a saved override | `shiftEnter`; alternatively `enter` |
| `CODEX_FOLLOWUP_MODE` | Follow-ups during active work | `steer`; alternatively `queue` |
| `CODEX_RELEASE_REPOSITORY` | Release notification repository in `owner/repo` format | This project |
| `CODEX_GITHUB_TOKEN` | Optional read-only token for release checks | Empty; public releases are checked anonymously |

`CODEX_API_TOKEN` is independent of the browser password and is not an OpenAI API key. Project paths refer to the Codex host and are accessed through the API.

## Settings and ENV precedence

**Settings** opens from the gear in the narrow activity bar, directly below the two allowance percentages. The dialog has three categories:

- **General settings:** language, send shortcut and follow-up behavior.
- **Codex settings:** display name, API endpoint and token, and project base directory.
- **Updates:** release repository, optional GitHub token and the Info dialog.

Each field shows whether it uses a custom value, ENV or a default. Expand **ENV details** for the variable name and fallback value. Changes survive category switches; **Save** and **Cancel** remain visible.

- **Empty field / Use default:** use the environment value, or the documented default when ENV is absent.
- **Filled field:** the saved setting takes precedence over ENV.
- Secret values are never returned to the browser. An existing saved secret stays unchanged until edited. **Use default** explicitly removes that override.

Overrides persist in `settings.json` in the data volume. Unsupported settings left by earlier installations are removed at startup; current preferences are preserved. Connection changes reconnect the bridge and are rejected while API calls are pending. Sent work is never replayed. A different Codex host may have different absolute project paths.

## Docker and Node startup

| Variable | Purpose | Default |
| --- | --- | --- |
| `WEB_BIND_IP` / `WEB_PORT` | Published Docker browser address and port | `0.0.0.0` / `8787` |
| `CODEX_WEB_IMAGE` | Image used by `compose.image.yml` | `ghcr.io/tweak90/codex-web-ui:latest` |
| `DATA_DIR` | Web data directory for direct Node startup | `.data`; `/data` in Docker |
| `PORT` / `BIND_ADDRESS` | Node HTTP listener | `8787` / `0.0.0.0` |

Ports, volumes and image selection belong to Docker/Compose configuration. The settings dialog does not manage containers or deploy updates.

## Browser password and reverse proxy

Set the password in the UI; there is no password default in ENV. Retain the data volume to preserve sign-in and settings across updates.


## Defaults and Info

When ENV and saved overrides are absent, the interface uses English, Shift+Enter for sending, steer for follow-ups, `Codex-Host` for its display name and this project's repository for releases. The project base directory is derived from Codex metadata; credentials are empty. The API address must be supplied in ENV or Settings. Compose can start the web UI before that address is configured; the connection stays offline until an endpoint is saved.

Configured environment values are marked **From environment**. **Custom value** indicates a saved override, while **Use default** clears it. Expanded ENV details show the underlying fallback. An existing language override is retained during updates.

**Info** contains the installed version and a read-only GitHub release check, with latest version and publication date. Public checks use no authentication and need no Codex-host command or Docker access. Cached results reduce repeated requests; **Check for updates** forces a new lookup. A token is optional for private repositories or a higher GitHub request limit.
