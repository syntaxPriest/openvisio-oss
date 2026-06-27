#!/usr/bin/env bash
# Applies GitHub discoverability/SEO settings for openvisio-oss:
#   1. Repository topics (max 20) — drive GitHub search ranking -> traffic/installs
#   2. Repository website URL -> https://openvisio.io
#   3. A versioned release tag so GitHub tracks (tarball) download counts
#
# Requires: gh auth login  (with repo admin rights on syntaxpriest/openvisio-oss)
set -euo pipefail

REPO="syntaxpriest/openvisio-oss"
SITE="https://openvisio.io"
# Match the published `openvisio` (mcp) package version.
VERSION="v$(node -p "require('./mcp/package.json').version")"

echo "==> Setting repository website -> ${SITE}"
gh repo edit "$REPO" --homepage "$SITE"

echo "==> Adding repository topics (20 highest-value)"
gh repo edit "$REPO" --add-topic \
mcp,mcp-server,model-context-protocol,code-graph,code-knowledge-graph,\
ai-coding-agent,ai-agents,claude-code,cursor,codex,windsurf,\
static-analysis,dependency-graph,call-graph,tree-sitter,\
developer-tools,token-optimization,context-engineering,\
codebase-visualization,local-first

echo "==> Ensuring release tag ${VERSION} exists (for download tracking)"
if gh release view "$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  echo "    release ${VERSION} already exists — skipping"
else
  gh release create "$VERSION" --repo "$REPO" \
    --title "OpenVisio ${VERSION}" \
    --notes "OpenVisio ${VERSION} — see https://www.npmjs.com/package/openvisio and ${SITE}. Auto-generated source archives below provide GitHub download metrics." \
    --target main
fi

echo "==> Done. Verify:"
gh repo view "$REPO" --json homepageUrl,repositoryTopics
