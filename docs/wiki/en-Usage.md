# Usage

[Deutsch](Benutzung.md) · [English home](en-Home.md)

## Navigation

The sidebar contains projects, archive, usage limits, settings and chat search. **New chat** appears directly below chat search.

- **Overview:** project information, chat list and image previews.
- **Chat:** project chat list with **Start new chat**, or the chat you last visited while switching tabs within this project.
- **Images:** the selected project's gallery.
- **Agents:** native subagents of this project, including archived agent histories.

Switching between Overview, Images, Agents and Chat returns you to the same open chat. Selecting another project clears that return target and shows its chat list first. Navigation does not create a chat.

The top bar contains context usage, theme switching and sign-out. Files, read-only Git and terminal are in the tool panel; mobile devices also have the workspace menu. The gear button opens settings, with access to notifications and version information.

## Projects

Use the plus button beside **Projects**:

| Choice | Action on the Codex host |
| --- | --- |
| Create local folder only | Create the folder and missing parent folders |
| Initialize Git | Also initialize a Git repository |
| Clone Git repository | Clone using the Codex user's existing Git access |
| Use existing directory | Register a directory that already exists |

Project menus provide rename, gallery, defaults and deletion. Deletion keeps files by default. Explicit folder deletion requires confirming the project name. Running tasks, protected paths and separately managed nested projects block folder deletion.

Model and reasoning effort defaults apply to new chats. Project instructions supplement existing Codex instructions when starting or reopening a chat.

## Chats and keyboard

Select an existing chat or explicitly start one. An empty new chat is a web draft until its first message starts a native Codex thread.

| Shortcut | Default action |
| --- | --- |
| Enter | Newline |
| Shift+Enter | Send |
| Ctrl/Cmd+K | New chat |
| Ctrl/Cmd+Shift+F | Full-text search |
| Ctrl/Cmd+S | Save the open file |

Reverse Enter and Shift+Enter in Settings if preferred. German and English are also available there. Draft text and attachments survive chat switches and reloads.

While Codex is working, choose how follow-ups behave in Settings: **Steer** sends instructions into the running task; **Queue** stores them in Codex's native queue for processing afterward. Queued messages are shown above the composer and survive browser closure. A failed or stopped task pauses automatic queue advancement until you start work again. Question answers and approvals are handled directly, independently of this follow-up preference.

Chats initially load the newest 20 stored entries. Scrolling up or choosing **Load older messages** retrieves more while preserving the reading position. Long commands and outputs can be expanded.

Right-click or use **⋯** for rename, assignment, pin, export and archive. Additional chat actions include forking a conversation.

## Questions and approvals

New questions open a dialog with suggested options and a free-text answer. Your text overrides an option. Nothing is sent until **Send answer** is clicked. **Answer later** closes the dialog; **Questions** in the sidebar reopens pending questions. Answered questions stay marked after reload.

Async answers retain their original call ID and question index. An unconfirmed delivery is not automatically retried; check the chat history first. Synchronous questions and native approvals are also supported. Unknown request types may require a JSON response.

## Files and attachments

Attach files with the paperclip, drag-and-drop or image paste. Limits are 20 attachments per message and 25 MB per file. Images use native image input; other files are referenced by their path on the Codex host. Removing an attachment from a message does not delete the uploaded file.

Uploaded images appear directly without a visible `[Image]` placeholder. The explorer can create, rename, move, download and permanently delete files and folders. Deletion requires confirming the name; the editor checks for intervening changes before saving. Folder downloads are ZIP archives; see [limits](en-Security-and-limitations.md).

## Gallery and archive

The gallery belongs to the selected project and includes generated images and screenshots from its chats. Explicit chat assignments override the original working directory. Separately managed nested projects have separate galleries.

Identical files are grouped by SHA-256 content even when names or paths differ. Internal runtime, cache and audit directories are excluded from the folder scan. Failed chat images offer a retry.

Archived chats can be read, bulk-restored or permanently deleted. Reading does not resume them. If the project folder is missing, assign the chat to an existing project before restoring it.

## Search, tasks and usage

Full-text search covers messages and activities, including archived chats, with an optional project filter. Initial indexing runs in the background. A result opens and highlights its history location.

**Tasks** shows running and recently updated chats, status, duration, errors and stop controls. Optional notices and sound work while the web UI is open.

**Usage limits** shows account data and reset credits returned by Codex. A reset requires confirmation. The context indicator shows chat tokens and observed compactions; it is separate from account usage limits.

## Agents

The **Agents** tab lists active and previous subagents for the selected project. Use status filters or search by name, role or task. Select an agent to read its output, commands and tool results. The newest 20 entries load first; **Load older output** retrieves earlier entries. **Open parent chat** returns to the conversation that spawned the agent. Status and saved output refresh while this view is open. Reading agent output never starts or resumes a task.

**Not loaded** is a native runtime status, not evidence that work completed. Archived agents remain readable when their saved histories still exist. Agents whose working directory belongs to a different project are kept separate.

## Info and allowance shortcuts

**Info** shows the installed version. **Check for updates** only reads GitHub releases; a newer release is shown with its version and publication date. No Docker access or installation is involved. Notifications, sound preferences and a panel-size reset button are not part of this dialog.

Below the activity bar's usage icon, the upper percentage is the remaining 5-hour allowance and the lower percentage the remaining weekly allowance. Unavailable data is shown as a dash; values are never invented. Clicking opens the full usage dialog.
