#!/usr/bin/env bash
# Symlink the built plugin artifacts into an Obsidian vault for local testing.
# Usage: ./scripts/link-to-vault.sh /absolute/path/to/your/vault
set -euo pipefail

VAULT="${1:?Usage: link-to-vault.sh <absolute-vault-path>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$VAULT/.obsidian/plugins/github-review"

if [ ! -f "$ROOT/main.js" ]; then
    echo "main.js not found. Run 'npm run build' (or 'npm run dev') first." >&2
    exit 1
fi

mkdir -p "$PLUGIN_DIR"
for f in main.js manifest.json styles.css; do
    ln -sf "$ROOT/$f" "$PLUGIN_DIR/$f"
done

echo "Linked into: $PLUGIN_DIR"
echo "Next: enable 'GitHub Review' under Settings -> Community plugins, then reload Obsidian (Cmd+R)."
echo "Keep 'npm run dev' running so main.js rebuilds on change."
