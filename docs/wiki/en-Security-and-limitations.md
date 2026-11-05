# Security and limitations

[Deutsch](Sicherheit-und-Grenzen.md) · [English home](en-Home.md)

> **This project was built entirely with AI. Use it at your own risk.**

## Access and permissions

The browser password protects control APIs, images and events. It is stored as a salted scrypt hash. Sessions use random tickets whose hashes are stored server-side. Mutating browser requests require a CSRF token and pass origin checks.

The external Codex API may require a separate bearer token. It is independent of the browser session. Saved API/GitHub tokens stay in the protected data volume and are never returned by settings endpoints. Anyone with the shared web password can edit instance settings.

The interface can run Codex tasks and host tools. Codex permissions and approvals still apply; management commands have real filesystem effects on the host. Password and path checks do not create another isolated VM. Configure network access, TLS and endpoint access for your environment.

## Files and delivery

File actions check canonical project paths and protect separately managed nested projects. Project-folder deletion requires an explicit option and name confirmation. Protected directories and running tasks are considered. There is no recycle bin. Removing an attachment from a message does not delete its file.

Mutations are not replayed after transport failure. Question replies and native queue starts persist claims before transmission. If delivery is uncertain, check the existing history or queue before submitting more work.

## Limits

| Feature | Limit or condition |
| --- | --- |
| History | Initially 20 stored entries per page |
| Attachments | At most 20 per message |
| File upload | 25 MB per file |
| File/ZIP download | 50 MB |
| ZIP creation | 5,000 files and 100 MB uncompressed |
| Gallery | At most 2,000 scanned image candidates per project, grouped by identical content |
| Search | First 100 matches displayed with total count and indexing progress |
| Desktop notices | UI open, browser permission and HTTPS or localhost |
| Compatibility | Verified with Codex 0.166.0 |

Models, usage limits and reset permissions come from the existing Codex account. Missing values are not invented. Some approvals remain bound to the client that started the task.

Official plugin UIs and computer-use views are not fully reproduced. Git commit/push/branch controls, Git worktrees and a recycle bin are outside scope. Read-only Git and project creation/clone options are included.

## Publication and private data

Do not commit personal paths, private addresses, credentials, `.env`, runtime data, uploads or user screenshots, or include them in release archives. Check reachable history, published downloads, container layers and metadata, registry versions, CI logs and build artifacts separately.

Pattern-based checks cannot conclusively exclude unknown or encrypted credentials. Revoke any real exposed key with its provider. Keep private audit reports out of the repository and explicitly record anything that could not be reviewed. See the repository [publication guide](https://github.com/Tweak90/codex-web/blob/main/docs/publication.md).
