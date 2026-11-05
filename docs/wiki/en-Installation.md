# Installation

[Deutsch](Installation.md) · [English home](en-Home.md)

Codex-Web is a Docker web client for an **existing external Codex App Server API**. It connects exclusively over `ws://` or `wss://`. Codex sign-in, project files and tools stay on the Codex host. Install this project on the web host; it does not start or bundle a Codex process.

## Requirements

- Docker on the web host; Compose is optional.
- A reachable Codex App Server WebSocket endpoint, verified with Codex **0.166.0**. See the [official App Server documentation](https://learn.chatgpt.com/docs/app-server) for the server's setup.
- Its bearer token if the API requires authentication.
- Python 3 and Git on the Codex host for project and file tools. These tools are invoked through the API.

Project directories and Codex sign-in data do not need to be mounted into the web container. The container only needs its own persistent data volume and network access to the API.

## Start the published image with Docker

Create `.env.web` on the web host:

```dotenv
CODEX_WS_URL=ws://codex-host.example:4500
CODEX_API_TOKEN=replace-with-your-api-token
HOST_LABEL=Codex-Host
```

Replace the example host and token with your API endpoint's values. Leave `CODEX_API_TOKEN` empty if that endpoint does not require a token.

```bash
docker volume create codex-web-data
docker pull ghcr.io/tweak90/codex-web-ui:latest
docker run -d --name codex-web --restart unless-stopped --init \
  -p 8787:8787 --env-file .env.web \
  -v codex-web-data:/data \
  ghcr.io/tweak90/codex-web-ui:latest
```

The public image supports Linux/amd64 and requires no registry sign-in, source checkout or local build. For a restricted fork's image, first use `docker login` with an account that has read access.

Open `http://web-host.example:8787` and set a browser password of at least four characters. The browser password is independent of the Codex account and API token. Keep the data volume for future updates.

## Use Compose

Check out the source on the web host:

```bash
git clone https://github.com/Tweak90/codex-web.git
cd codex-web
cp .env.example .env
```

Set `CODEX_WS_URL` and, if required, `CODEX_API_TOKEN` in `.env`. Then use the published image:

```bash
docker compose -f compose.image.yml up -d
```

Or build the web image from source:

```bash
docker compose up -d --build
```

Both configurations connect to the external API. Both retain web data in `console-data` at `/data`.

## Run Node directly for development

```bash
npm ci
CODEX_WS_URL=ws://codex-host.example:4500 npm start
```

Provide `CODEX_API_TOKEN` through your environment if required. `CODEX_WS_URL` or a saved API address is required; no local connection is selected automatically. Continue with [Configuration](en-Configuration.md), [Usage](en-Usage.md) and [Updates](en-Operations-and-updates.md).
