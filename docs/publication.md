# Publication review

[Deutsch](publication.de.md)

Keep local configuration in `.env` and credentials in the appropriate secret store. Never commit or publish `.env`, SSH keys, runtime data, private audit reports or user screenshots. Use reserved `.example` hostnames in documentation and explicitly configure the API endpoint. Derive the remote home directory from Codex metadata.

## Current source and reachable history

```bash
npm run check:publication
node scripts/check-publication.mjs --history
gitleaks git --redact=100 --log-opts="--all"
```

The first check reviews the working tree. The history check reviews reachable blobs, commit metadata and annotated tags across all local branches and tags. [Gitleaks](https://github.com/gitleaks/gitleaks) is a separate secret scanner. Reports must never reproduce unredacted credentials. Pattern matching is a regression guard, not proof that every possible secret is absent.

Fetch and review all remote branches and tags before publication. Revoke any real exposed credential with its provider. Keep private findings and review files outside tracked sources.

## Other publication surfaces

- Review release descriptions, uploaded source archives, Docker downloads and checksums separately. They do not change automatically when source changes.
- Inspect application layers, image configuration, labels and build metadata. A deleted file may remain in an earlier image layer.
- Review registry versions, SHA tags, provenance attestations and build caches independently of local images.
- Review workflow logs, build artifacts, issues, pull requests and additional Git references.
- GitHub repository visibility and container package visibility are separate. Record any inaccessible review areas in the private audit report.

Build metadata can include a full GitHub event payload, including personal pusher/profile information. The release workflow disables that provenance output, build summaries and build-record uploads. The manual **Check container metadata** workflow reviews registry metadata using repository-scoped credentials and prints only finding locations. Its optional sanitization mode removes provenance versions while retaining all runnable image platforms and tags; use it only when deliberately cleaning published metadata.

Deleting references or image versions may leave old Git commits or registry blobs retrievable by hash. Verify anonymous access to the exact old objects rather than only inspecting the current history and tags. A public package cannot be made private again through GitHub's visibility setting; retained content may require package withdrawal and provider-side cleanup. Do not assert permanent erasure based on a version deletion alone.

Set the repository variable `PUBLISH_CONTAINER=false` to pause container publication while retaining source and release downloads. This prevents the tag workflow from republishing an image during a privacy cleanup. The package audit's withdrawal mode removes the package's public entry point; check the old object URLs afterward. A later public restart must review history, caches and registry namespaces again.

Public project URLs, package addresses and GitHub noreply attribution identify the project and its contributors. They are not deployment configuration. Forks can set `CODEX_VIEWPORT_IMAGE` and `CODEX_RELEASE_REPOSITORY`.

Review and cleanup do not deploy the application. Repository and package visibility changes require explicit authorization.
