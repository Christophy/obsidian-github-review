# GitHub Review

Review GitHub **issues and pull requests** in Obsidian — built for reading and reviewing Markdown
**spec / design documents**, which render poorly on GitHub's web UI.

You read and discuss specs in Obsidian's native Markdown, and every action writes straight back to
GitHub. Comments and reviews are made as the token owner, and approvals use GitHub's **native PR
review**, so branch protection recognises them. GitHub stays the single source of truth — nothing
is stored locally.

## Features

Organised around the spec-review flow:

- **Raise issues from templates** — open a new issue that follows the repo's issue templates
  (Markdown templates and YAML issue forms), with a **Write / Preview** Markdown editor and
  @mention autocomplete.
- **Read specs comfortably** — PR Markdown files and issue/PR bodies & comments render as Markdown
  (not diffs); comments appear as cards with avatar, author, and relative time.
- **See the whole change set** — every changed file in a PR: Markdown rendered, other files as a
  colored diff, each collapsible with a **"Viewed"** checkbox.
- **Review in place** — comment, **close**, or submit a GitHub review
  (**Comment / Approve / Request changes**). Existing inline threads show read-only.
- **Ask Claude about it** — a built-in, read-only **stdio MCP server** lets an external Claude
  client (e.g. [Claudian](https://github.com/YishenTu/claudian) or the **Claude Code** CLI) see the
  pull request or issue you're viewing — and any item you have open. The plugin writes the open items
  to a small store file and registers the server in your vault's `.claude/mcp.json` automatically, so
  a client like Claudian picks it up with no manual setup; then just ask "what's this PR about?".
  Your repo's files come for free, since those clients run with the vault as their working directory.
  **No port, no token, no separate Node** — the client spawns the server on demand using Obsidian's
  own Node, and your GitHub token never leaves the plugin. See
  [Connect a Claude client](#connect-a-claude-client-claudian).
- **@mention bots** — autocomplete for the repo's bots, to pull one into the review.
- **Find what to review** — a queue scoped to the vault's GitHub repo, split into
  **Pull requests** / **Issues** tabs (or a manual repo list; optionally include closed items).
- **Open by URL & stay current** — jump to any issue/PR by link; manual refresh plus optional
  cheap ETag polling.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module layout.

## Requirements

- **Obsidian desktop** (the plugin reads your vault's git remote; it is desktop-only).
- A **GitHub fine-grained personal access token** (see [Token](#token)).
- For **AI chat** (optional): an external Claude client such as
  [Claudian](https://github.com/YishenTu/claudian) or the **Claude Code** CLI, installed and logged
  in. The plugin exposes the open PR/issue to it via a local MCP server; everything else works
  without it.

## Installation

### From a release (manual)

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](../../releases/latest).
2. Put them in `<your-vault>/.obsidian/plugins/github-review/`.
3. In Obsidian: **Settings → Community plugins**, enable community plugins, then enable
   **GitHub Review**.

### From source (development)

```bash
git clone <this-repo> && cd obsidian-github-review
npm install
npm run build                              # produces main.js
./scripts/link-to-vault.sh /path/to/vault  # symlink main.js / manifest.json / styles.css into the vault
```

Then enable the plugin in Obsidian. Use `npm run dev` for a watch build and `Cmd/Ctrl+R` to reload.

## Configuration

Open **Settings → GitHub Review**:

| Setting | What it does |
|---|---|
| **GitHub token** | Your fine-grained PAT (stored in the vault's `data.json`). |
| **Follow this vault's GitHub repository** | On: scope the queue to the repo this vault belongs to. Off: use the manual list below. |
| **Repositories** | `owner/repo` per line, used when not following the vault repo (or none detected). |
| **Include closed issues & PRs** | Also list closed/merged items. |
| **Auto-refresh interval (seconds)** | Poll open views with conditional requests; `0` disables. |
| **Claude client integration (MCP)** | Expose the open PR/issue to a Claude client via a local **stdio** MCP server (no port, no token, read-only). On by default; **Copy config** is for non-Claudian clients. |

### Connect a Claude client (Claudian)

When the integration is enabled, the plugin writes the issue/PR you're viewing to a small store file
and writes a tiny **stdio** MCP server (`mcp-stdio.js`, embedded in `main.js`) into its own plugin
folder. A Claude client spawns that server on demand — no port, no running service, no separate Node
(it uses Obsidian's own). **For [Claudian](https://github.com/YishenTu/claudian) you don't configure
anything** — the plugin registers the server in your vault's `.claude/mcp.json` (which Claudian
reads), so it shows up automatically.

1. Keep **Settings → GitHub Review → Claude client integration (MCP)** enabled (it is by default).
2. Open a pull request or issue in the review tab.
3. In Claudian, **reload** once (so it re-reads the config), then just ask — e.g. *"what's this PR
   about?"* or *"what changed in the file X?"*. Claudian runs with your vault as its working
   directory, so it can read your repo's files too.

The agent is told to call `get_current_item` for "this / the current PR or issue", so it pulls the
context without you pasting a link. Other tools: `get_changed_file` (a file's content/diff) and
`get_item` (pin to a specific item you have open, by `owner`/`repo`/`number`/`type`). The server is
read-only and holds no token — it only reads the store file, which contains the items you have open
(no token is written anywhere; it never leaves the plugin).

**Other Claude clients** (e.g. the `claude` CLI): use **Copy config** and add the entry to that
client (it's a standard stdio MCP server: `command` + `args`).

> Heads-up: Claudian keeps its **own** conversation history and isn't tied to a specific PR/issue —
> switching review tabs doesn't switch its session, and its history won't auto-load per item. Use
> `get_item` to pin a conversation to one open item, or `get_current_item` for whichever is active.

### Token

Use a **fine-grained personal access token** scoped to the repos you review, with:

| Permission | Level |
|---|---|
| Contents | Read |
| Pull requests | Read & write |
| Issues | Read & write |
| Metadata | Read |

> The token is stored in plaintext in the vault's `data.json`. Don't sync a vault containing it to
> an untrusted location. GitHub also forbids approving your own PR — the Approve option is disabled
> then.

## Usage

- Open the **review queue** from the ribbon (git-pull-request icon) or the command
  *GitHub Review: Open review queue*.
- Click **New issue** in the queue (or the command *GitHub Review: Create new issue*) to compose an
  issue: pick a template (it pre-fills the title, labels and body), edit with **Write / Preview**
  tabs, and create it — it opens straight away.
- Switch between the **Pull requests** and **Issues** tabs; click an item to open it (reusing its
  tab if already open).
- In a PR: read the description, expand/collapse each changed file, mark files **Viewed**, read
  comments, and **Comment** / **Close** / **Review changes** (Comment, Approve, Request changes).
- To **ask Claude** about the open item, use an external Claude client (e.g. Claudian) — see
  [Connect a Claude client](#connect-a-claude-client-claudian). The command
  *GitHub Review: Copy MCP server config for Claude clients* copies the config for non-Claudian clients.
- Type `@` in any comment box to mention a repo bot.
- Use the command *GitHub Review: Open issue/PR by URL* to jump to a specific item.
- Click **Refresh** (or rely on auto-refresh) to pull the latest.

## Development

```bash
npm run dev        # esbuild watch -> main.js
npm run build      # tsc typecheck + production bundle
npm run lint       # eslint
npm run test:unit  # tsc --noEmit + mocha unit tests
npm run test:e2e   # WebdriverIO against a real sandboxed Obsidian (downloads Obsidian on first run)
```

### CI & merge gate

`.github/workflows/ci.yml` runs **lint + build + unit + end-to-end tests** (the E2E spin up a real
sandboxed Obsidian) on every push and pull request, so a green CI means the requirement tests
actually passed.

To **require** a green CI before merging into `main`, enable a branch protection rule (or
repository ruleset) on `main` that requires the **`test`** status check and "branches up to date".
A workflow can't enforce this on its own — it's a one-time GitHub repository setting
(Settings → Branches / Rules).

## Releasing

Versions follow the Obsidian convention (the git tag *is* the version, no `v` prefix):

```bash
npm version patch   # bumps manifest.json + versions.json, commits, and tags
git push --follow-tags
```

Pushing the tag triggers the **Release** workflow, which builds and attaches `main.js`,
`manifest.json`, `styles.css`, and `github-review.zip` to a GitHub release.
