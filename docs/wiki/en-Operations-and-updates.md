# Operation and updates

[Deutsch](Betrieb-und-Updates.md) · [English home](en-Home.md)

## Persistent data

The web container mounts its data volume at `/data`. It stores authentication, sessions, project assignments, drafts, settings, question state, queue ownership and the search index. The Docker CLI example uses `codex-viewport-data`; Compose uses `viewport-data` with the explicit name selected by `CODEX_VIEWPORT_VOLUME`.

Native chats and project files stay on the Codex host. Uploads are stored under `.codex-viewport/uploads/` inside the project. Closing the browser or restarting the web container does not stop a Codex task on that host.

## Update a published-image container

For the Docker CLI installation, pull the image and replace the container while keeping its environment file and volume:

```bash
docker pull ghcr.io/tweak90/codex-viewport-ui:latest
docker stop codex-viewport
docker rm codex-viewport
docker run -d --name codex-viewport --restart unless-stopped --init \
  -p 8787:8787 --env-file .env.web \
  -v codex-viewport-data:/data \
  ghcr.io/tweak90/codex-viewport-ui:latest
```

Keep `.env.web` and the same `codex-viewport-data` volume. Do not use volume-deletion options. Reload the browser after startup.

For Compose:

```bash
docker compose -f compose.image.yml pull
docker compose -f compose.image.yml up -d
```

`latest` is a moving tag. Pulling obtains its current image; the running container uses it after recreation. A fixed version tag stays on that release. Codex Viewport's version check reads release metadata and does not deploy anything.

Saved settings still override ENV after an update. Clear a field or choose **Use default** to restore environment precedence. Keep the volume to retain the password and preferences.

## Update a source build

```bash
git pull --ff-only
docker compose up -d --build
```


## Backups and restoration

Back up the web volume separately from Codex host data. The web volume contains secrets, drafts, questions and search text. Stop the web server while copying or use a consistent snapshot method.

Restore web data under the same volume mount and provide the corresponding host configuration. Projects must be reachable at their stored absolute host paths. Removing the web volume also removes the browser password; this is unnecessary for a normal update.

## Diagnostics and downloads

```bash
docker logs --tail=100 codex-viewport
# For Compose:
docker compose -f compose.image.yml ps
docker compose -f compose.image.yml logs --tail=100 web
```

Review logs before sharing them.

Public `/healthz` checks the web server; with a signed-in session it also reports Codex connection state.

Releases include source, a Linux/amd64 Docker archive and `SHA256SUMS`. Verify checksums before importing a downloaded image. The release pipeline also publishes version tags and `latest` to GHCR.
