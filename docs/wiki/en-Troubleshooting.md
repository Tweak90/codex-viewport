# Troubleshooting

[Deutsch](Fehlerbehebung.md) · [English home](en-Home.md)

## Web UI works but Codex is offline

1. Check `CODEX_WS_URL`: use a `ws://` or `wss://` endpoint, not a filesystem path.
2. Check connectivity from the web container to the Codex API port.
3. Compare `CODEX_API_TOKEN` on both hosts without copying it into logs or issue reports.
4. Check the daemon and socket on the Codex host:

```bash
codex app-server daemon version
readlink -f "$HOME/.codex/app-server-control/app-server-control.sock"
```

A healthy gateway can still have an inaccessible Codex socket. The signed-in web UI shows the actual Codex connection state.

## Missing socket or permission denied

Match `CODEX_SOCKET_DIR` to the directory containing the control socket. For an absolute symlink, also configure `CODEX_RUNTIME_SOCKET_DIR` for its real target. Gateway UID/GID must match socket permissions. Missing bind-mount directories are not created automatically.

## Settings appear to ignore ENV

A saved, nonempty setting overrides ENV. Open the gear menu, clear the field or use **Use ENV**, then save. Existing secrets stay unchanged when not edited; the reset button explicitly removes their stored override. Docker ports and volume mounts are deployment settings and do not change through this menu.

## Sign-in problems

Set a password on first launch. Keep the same persistent data volume across updates. Reload the page or sign in again if the browser session is stale. The browser password is independent of the Codex account and gateway token. Deleting the volume resets more than the password and is not an update procedure.

## Project cannot be created

The path belongs to the Codex host, whose Codex user must have write access. The app does not guess a project base directory when Codex home metadata is missing. Git imports require working Git and repository access on that host.

## Chats or questions are missing

Check project assignment, search and archive filters, and load more chats if needed. Empty chats can be saved web drafts rather than native conversations. Switching projects initially shows a chat list; switching tabs within one project can return to the last open chat.

New asynchronous questions open a dialog; the sidebar **Questions** button reopens pending ones. Existing question metadata is recovered in the background. An answer with uncertain delivery is not resent automatically: inspect the chat history first. Some native approvals remain bound to the client that originally started the task.

## Images are missing or duplicated

Use **Retry** on a failed chat image. Check whether the file remains on the Codex host or image content remains in native history. Galleries follow project and chat assignment; scanning large histories can take time.

The web logo loads directly from `/assets/logo.png`, not as a Codex-host file through `/api/media`. Reload after updating to use the current image resolver.

The gallery groups byte-identical files by SHA-256. Visually similar files with different contents or metadata can still be separate. Internal runtime and audit folders are excluded from folder scans.

## Queued follow-up has not started

The queue is native to Codex and is shown above the composer. Automatic advancement pauses after a failed or interrupted task. Starting a new task resumes normal processing. Entries owned by another client remain under that client's control. An unconfirmed queue-start operation is not repeated automatically.

## Usage limits, context or notifications are missing

Only values supplied by the App Server are displayed. Check browser sign-in, API connection and Codex account state; missing values are not replaced by guessed limits. Context values come from token events or saved native history.

Desktop notifications require HTTPS or localhost, permission in the browser and enabled notices in settings. Keep the UI open. Sound needs a user interaction; in-app notices do not require desktop notification support.

## Release check or proxy connections fail

Release checks need an authenticated `gh` on the Codex host or a read-only `CODEX_GITHUB_TOKEN`. For forks, set `CODEX_RELEASE_REPOSITORY`. This only reads metadata and does not pull images.

For a reverse proxy, check WebSocket upgrades, forwarded host/protocol headers and timeouts. Connections reconnect, but previously sent mutations are never replayed. Inspect history before manually repeating work whose outcome is unclear.
