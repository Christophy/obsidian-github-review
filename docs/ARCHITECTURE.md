# Module design / Architecture

> The module layout, responsibilities, and dependency direction of the plugin.

## Decisions

- **Three layers**: transport (`github/`) → stateless services (`core/`) → views/ui.
- **Stateless services**: plain classes, no global state; each view holds its own render state and
  re-fetches after actions.
- **HTTP is injected** into the client, so `core` and `github` stay unit-testable under Node
  without mocking `obsidian`.
- **Reuse Obsidian** where it already does the job: Markdown rendering, ` ```diff ` syntax
  highlighting (PrismJS), and the readable-line-width variable for layout.
- **AI chat lives in an external Claude client**, not in the plugin. The plugin writes the open
  review items to a small store file and writes a tiny, dependency-free **stdio MCP server** — whose
  source is embedded in `main.js` (`mcp-stdio-source.ts`) and materialized to `<plugin>/mcp-stdio.js`
  at runtime, since Obsidian's community installer only delivers main.js/manifest/styles. A client
  (Claudian, the Claude Code CLI) spawns it on demand via Obsidian's own Node — no port, no running
  service, no token. It auto-registers the server in `<vault>/.claude/mcp.json`. The server only
  reads the store file, so the GitHub token never leaves the plugin.

## Layout

```
src/
├── main.ts                  # entry: views/commands/ribbon/settings; builds the client + services
│                            #   from the token (the single wiring point); detects the vault repo
├── settings.ts              # PluginSettings + defaults + SettingTab (token, repos, options)
├── git-detect.ts            # read the vault's git "origin" remote (desktop/Node)
│
├── github/                  # layer 1: transport (HTTP only, returns raw JSON)
│   ├── client.ts            # requestUrl wrapper: URL assembly, auth, ETag caching, rate-limit/errors
│   └── types.ts             # raw GitHub API response shapes
│
├── core/                    # layer 2: stateless services + pure logic (everything unit-tested)
│   ├── model.ts             # domain types (Ref / IssueDetail / PrDetail / ChangedFile / Comment / …)
│   ├── mappers.ts           # raw JSON → domain objects; review-payload assembly
│   ├── github-ref.ts        # parse a GitHub issue/PR URL → Ref
│   ├── git-remote.ts        # parse a git remote URL → "owner/repo"
│   ├── mentions.ts          # bot-handle + @mention-token text helpers
│   ├── format.ts            # relative-time formatting (Intl.RelativeTimeFormat)
│   ├── queue-service.ts     # list a repo's issues & PRs
│   ├── review-service.ts    # fetch an issue/PR; comment / submit review / close
│   ├── mention-service.ts   # discover repo bot @handles from issue/PR authors
│   ├── issue-service.ts     # list a repo's issue templates; create a new issue
│   └── issue-template.ts    # parse Markdown templates / YAML issue forms → a starting point
│
├── ai/                      # expose plugin context to external Claude clients via MCP
│   ├── plugin-context.ts    # what tool handlers get (client + review service + the ref)
│   ├── tool.ts              # PluginTool interface (name/description/handler)
│   ├── tools/
│   │   └── get-item.ts      # serialize a PR/issue's details (used to build the snapshot)
│   ├── context-snapshot.ts  # build per-item snapshots + the keyed store (current + items)
│   └── claudian-config.ts   # merge/strip our entry in <vault>/.claude/mcp.json (pure)
│
├── mcp-stdio-source.ts      # the stdio MCP server source, embedded as a string and written to
│                            #   <plugin>/mcp-stdio.js at runtime; serves the store over stdio (no deps)
│
├── views/                   # layer 3: Obsidian ItemViews; each holds its own state
│   ├── queue-view.ts        # sidebar: PR/Issue tabs, polling, click to open
│   └── review-view.ts       # main panel: orchestrates fetch → render (ui) → action → refresh
│
└── ui/                      # stateless presentation components (depend only on obsidian)
    ├── render.ts            # MarkdownRenderer wrapper
    ├── comment-box.ts       # comment textarea + Comment/secondary buttons
    ├── review-actions.ts    # "Review changes" → Comment/Approve/Request changes + Submit review
    ├── mention-autocomplete.ts  # @-mention dropdown on a textarea
    ├── url-prompt.ts         # modal to open an issue/PR by URL
    └── new-issue-modal.ts    # compose a new issue: template picker + Write/Preview body
```

## Dependency direction (acyclic, downward only)

```
main ──▶ settings · git-detect · views · core · github
views ──▶ core(services/model) · ui
core(services) ──▶ github(client) · core(mappers/model)
github(client) ──▶ github(types)
ui ──▶ (obsidian only)
```

No upward dependencies; views and services don't reference each other sideways.

## Key boundaries

- **client returns raw JSON; mappers convert to domain objects** — views only ever see clean
  domain types.
- **ETag caching lives in the client** — every GET is conditional, so refresh/polling is cheap.
- **review-view is the orchestrator** — it loads detail, delegates rendering to `ui/`, wires
  actions, and re-fetches; rendering details live in `ui/`, so the heaviest view stays manageable.
- **main.ts is the only wiring point** — it builds the client + services from the token and injects
  them; nothing else knows where the token comes from.

## Unit-tested concerns

`github-ref`, `git-remote`, `git-detect` (.git/config parse + walk-up), `mappers`, `mentions`,
`format`, `issue-template`, `context-snapshot` (snapshot serialization + the keyed `refKey`) and
`claudian-config` (the `.claude/mcp.json` merge/strip safety), the services, and the client's URL /
error / ETag / empty-body handling — all pure or fake-injected (mocha + chai). Views, the new-issue
flow, and that the plugin writes the keyed store + stdio config + `mcp-stdio.js` and that server
serves the open item to a real MCP client (spawned) are covered by the WebdriverIO end-to-end suite
against a real sandboxed Obsidian. Issue templates are parsed with the `yaml` package (the `js-yaml` alternative is
banned by the lint config).
