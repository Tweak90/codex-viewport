# Changelog

[Deutsch](CHANGELOG.de.md)

## 1.1.0 — 2026-11-06

- Renamed the application to Codex Viewport with the tagline “A self-hosted web remote for Codex.” across the UI, metadata and documentation.
- Integrated the transparent version of the user-supplied logo across sign-in, documentation, compact UI icons and the favicon; cached logo URLs refresh automatically. Repository, Docker images, configuration variables and new upload paths now use Codex Viewport identifiers; upgrades must explicitly retain the existing data volume.

## 1.0.2 — 2026-11-05

- Settings gear restored below the 5-hour and weekly percentages in the narrow activity bar.
- Removed Settings and Usage limits entries from the wide project sidebar. Both remain accessible as compact menu icons on mobile.
- Attachments wait for an in-progress chat creation, preventing uploads from being assigned to a missing chat.

## 1.0.1 — 2026-11-05

- English and sensible application defaults when ENV is absent; explicit environment/source markers and saved overrides.
- Info replaces the options dialog; notification/sound controls and the panel reset action are removed.
- Update checks read public GitHub releases anonymously from the web container, with version and release date; no host commands or Docker access.
- Activity-bar allowance shortcut displays only remaining 5-hour and weekly percentages.
- Settings appear only in the left sidebar, above usage limits, with General, Codex and Updates categories.
- Clear field descriptions, collapsible ENV details, keyboard navigation and a fixed Save/Cancel footer preserve edits across categories.
- Codex Viewport connects exclusively to the external WebSocket API; local transport, host-side launch tools and their configuration/examples were removed. Retired saved settings migrate automatically.
- Project Agents tab shows active and previous agents, archived histories, search/status filters, parent chats and paginated output without starting work.
- New blue terminal logo has a transparent background throughout the UI, chat, favicon and documentation; cached UI references refresh automatically.
- Open select menus use readable foreground/background colors in both themes.
- German/English README, Wiki, architecture and installation guides match the external-API setup.

## 1.0.0 — 2026-11-05

First release of the independent Codex Viewport browser interface.

- Connection to an existing Codex App Server API.
- Password sign-in, projects with real folders, multiple chats, archive, search and saved drafts.
- German and English UI, light/dark themes and responsive IDE layout.
- Gear settings with saved-value precedence over ENV, configurable Enter keys and steer/queue follow-ups.
- Native message queue and question dialogs with explicit replies and delivery tracking.
- File/image uploads, inline images, SHA-256-grouped project galleries, editor, terminal and ZIP downloads.
- Usage limits, reset confirmation, context usage, project defaults, task overview and optional notifications.
- Project tabs return to the last open chat; a different project initially shows a chat list.
- Docker-console and Compose setup, persistent volumes, bilingual Wiki sources and maintenance guides.
- Published bilingual GitHub Wiki with a language chooser, logo and direct installation, usage and technical documentation links.
- Neutral Git metadata without author email addresses; published images omit build-event provenance.
