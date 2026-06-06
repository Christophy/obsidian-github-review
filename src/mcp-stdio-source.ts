/**
 * Source of the standalone stdio MCP server, embedded as a string and written to
 * `<plugin>/mcp-stdio.js` at runtime (so it ships inside main.js — Obsidian's
 * community installer only delivers main.js / manifest.json / styles.css).
 *
 * A Claude client (Claudian, the `claude` CLI) spawns it via Obsidian's own Node
 * (process.execPath + ELECTRON_RUN_AS_NODE). It is dependency-free: a minimal
 * newline-delimited JSON-RPC 2.0 server that reads the store file the plugin
 * writes (argv[2]) and serves the review context. No SDK, no token, no network.
 *
 * NOTE: this is plain ES2018 JS held as a String.raw literal (so `\n` etc. survive
 * verbatim). Keep it free of backticks and ${...}.
 */
export const MCP_STDIO_SOURCE = String.raw`'use strict';
const fs = require('node:fs');
const storePath = process.argv[2];

function loadStore() {
  try {
    const p = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (p && typeof p === 'object') return { current: p.current || null, items: p.items || {} };
  } catch (e) {}
  return { current: null, items: {} };
}

const NO_CURRENT = "No pull request or issue is currently open in the Obsidian GitHub Review tab. Ask the user to open one there.";

function currentItem(s) {
  const it = s.current ? s.items[s.current] : null;
  return (it && it.item) || NO_CURRENT;
}
function itemByRef(s, owner, repo, number, type) {
  const it = s.items[owner + "/" + repo + "/" + type + "/" + number];
  if (it && it.item) return it.item;
  return owner + "/" + repo + " #" + number + " isn't open in the GitHub Review tab. Ask the user to open it there, then try again.";
}
function changedFile(s, filename) {
  const it = s.current ? s.items[s.current] : null;
  if (!it) return NO_CURRENT;
  const cf = it.changedFiles || {};
  if (Object.prototype.hasOwnProperty.call(cf, filename)) return cf[filename];
  const names = Object.keys(cf);
  if (names.length === 0) return "The current item has no changed files (it may be an issue, not a pull request).";
  return 'No changed file named "' + filename + '". Changed files: ' + names.join(", ");
}

const TOOLS = [
  { name: "get_current_item",
    description: "Returns the GitHub pull request or issue currently open in the user's Obsidian GitHub Review tab — title, state, author, labels, body, comments, and (for PRs) the changed files. Takes NO arguments and needs NO link or number. ALWAYS call this — instead of asking the user for a link — whenever they mention 'this'/'the current'/'the open' PR or issue, ask what they're looking at, or ask whether you can see their PR/issue. Use get_changed_file for a file's content or diff.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_item",
    description: "Get a specific GitHub pull request or issue the user has open in a GitHub Review tab, by reference. Only items currently open in the review tabs are available; otherwise it asks the user to open it.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, number: { type: "number" }, type: { type: "string", enum: ["issue", "pull"] } }, required: ["owner", "repo", "number", "type"], additionalProperties: false } },
  { name: "get_changed_file",
    description: "Get the content (Markdown files) or unified diff (other files) of one changed file in the pull request currently open in the review tab, by its path.",
    inputSchema: { type: "object", properties: { filename: { type: "string" } }, required: ["filename"], additionalProperties: false } }
];

function callTool(name, args) {
  const s = loadStore();
  args = args || {};
  let text;
  if (name === "get_current_item") text = currentItem(s);
  else if (name === "get_item") text = itemByRef(s, String(args.owner || ""), String(args.repo || ""), Number(args.number || 0), args.type === "pull" ? "pull" : "issue");
  else if (name === "get_changed_file") text = changedFile(s, String(args.filename || ""));
  else return null;
  return { content: [{ type: "text", text: text }] };
}

function handle(msg) {
  const id = msg.id;
  const m = msg.method;
  if (m === "initialize") {
    const pv = (msg.params && msg.params.protocolVersion) || "2024-11-05";
    return { jsonrpc: "2.0", id: id, result: { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: { name: "github_review", version: "1.0.0" } } };
  }
  if (m === "tools/list") return { jsonrpc: "2.0", id: id, result: { tools: TOOLS } };
  if (m === "tools/call") {
    const r = callTool(msg.params && msg.params.name, msg.params && msg.params.arguments);
    if (!r) return { jsonrpc: "2.0", id: id, error: { code: -32602, message: "Unknown tool" } };
    return { jsonrpc: "2.0", id: id, result: r };
  }
  if (m === "ping") return { jsonrpc: "2.0", id: id, result: {} };
  if (id === undefined || id === null) return null;
  return { jsonrpc: "2.0", id: id, error: { code: -32601, message: "Method not found: " + m } };
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (chunk) {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    const res = handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  }
});
process.stdin.on("end", function () { process.exit(0); });
`;
