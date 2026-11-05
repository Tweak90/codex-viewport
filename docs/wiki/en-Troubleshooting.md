# Troubleshooting

[Deutsch](Fehlerbehebung.md) · [English home](en-Home.md)

## Web UI works but Codex is offline

1. Set `CODEX_WS_URL` to the external API's `ws://` or `wss://` address.
2. Check DNS, routing, firewall access and the API port from the web container.
3. If authentication is required, verify `CODEX_API_TOKEN` against that API's configuration.
4. Check whether the external App Server is running and whether a proxy forwards WebSocket upgrades. For `wss://`, check its certificate and hostname.

The signed-in UI shows the actual API connection state. A healthy web container alone does not prove that its external API is reachable.

## Settings appear to ignore ENV

A saved, nonempty setting overrides ENV. Open the gear menu, clear the field or use **Use default**, then save. Existing secrets stay unchanged when not edited; the reset button explicitly removes their stored override. Docker ports and volume mounts are deployment settings and do not change through this menu.

## Sign-in problems

Set a password on first launch. Keep the same persistent data volume across updates. Reload the page or sign in again if the browser session is stale. The browser password is independent of the Codex account and API token. Deleting the volume resets more than the password and is not an update procedure.

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

## Usage limits or context are missing

Only values supplied by the App Server are displayed. Check browser sign-in, API connection and Codex account state; missing values are not replaced by guessed limits. Context values come from token events or saved native history.


## Release check or proxy connections fail

Release checks use anonymous HTTPS requests from the web container to GitHub by default. An optional read-only `CODEX_GITHUB_TOKEN` supports private repositories or a higher request limit. For forks, set `CODEX_RELEASE_REPOSITORY`. This only reads metadata and does not pull images.

For a reverse proxy, check WebSocket upgrades, forwarded host/protocol headers and timeouts. Connections reconnect, but previously sent mutations are never replayed. Inspect history before manually repeating work whose outcome is unclear.

## Agent list is empty

Agents are native subagent threads whose working directory matches the selected project. Select the correct project, clear search/status filters and load more entries. Deleted or never-persisted agent histories cannot be reconstructed. **Not loaded** describes native runtime state rather than a completion result.
