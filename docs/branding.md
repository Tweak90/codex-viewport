# Codex Viewport branding

**A self-hosted web remote for Codex.**

The logo was supplied and selected by the project owner. It combines a teal terminal/cloud symbol, dark viewport corners and the Codex Viewport wordmark. Its light background was removed with the built-in image editing tool; the result has a genuine PNG alpha channel, including the enclosed spaces within the symbol and letters. `public/assets/logo.png` is the shared transparent wordmark for sign-in, README and the Wiki; `public/assets/logo-transparent.png` keeps the prepared transparent variant.

`public/assets/logo-mark.svg` displays only the symbol using an SVG viewport over the embedded transparent PNG (1678 × 937 pixels, viewBox `172 164 615 615`). It does not redraw or regenerate the artwork. It is used in the sidebar, chat avatars and favicon. Both assets have a transparent background in light and dark themes; no background tile is added. The dark theme applies a CSS brightness filter so the charcoal lettering and corner details remain visible; the PNG itself retains its colors. Asset URLs use `v=viewport-transparent-1` to refresh cached logos.

The public product name is **Codex Viewport**; the npm package, repository and local Docker image are `codex-viewport`. Published containers use `ghcr.io/tweak90/codex-viewport-ui`. Configuration uses `CODEX_VIEWPORT_LANGUAGE`, `CODEX_VIEWPORT_IMAGE` and `CODEX_VIEWPORT_VOLUME`; new uploads use `.codex-viewport/uploads/`. The operator must explicitly reuse an existing data volume when upgrading. See the 1.1.0 release notes for migration details. Historical Git commits and already published releases remain available.

Compatibility remains verified with Codex 0.166.0. The web client connects exclusively to an external App Server over WebSocket.
