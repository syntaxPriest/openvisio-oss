// Generates a large, curated, de-duplicated keyword set for the OpenVisio npm
// packages. All keywords are domain-relevant (MCP / code-graph / AI coding
// agents / static analysis), following the high-volume-keyword growth strategy.
// Usage: node scripts/gen-keywords.mjs            -> prints count + list
//        node scripts/gen-keywords.mjs --write    -> writes into mcp/core/viewer package.json

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// npm constraints we respect: lowercase, <=214 chars per keyword (we stay short),
// hyphenated, no spaces.
const norm = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.+-]/g, "");

const out = new Set();
const add = (...xs) => xs.flat().forEach((x) => x && out.add(norm(x)));

// 1) Core identity ---------------------------------------------------------
add(
  "openvisio", "code-graph", "code-knowledge-graph", "knowledge-graph",
  "codebase-graph", "code-map", "codebase-map", "repo-map", "repository-map",
  "code-atlas", "code-city", "graph-native", "deterministic-code-graph",
);

// 2) MCP ecosystem ---------------------------------------------------------
const mcp = [
  "mcp", "mcp-server", "mcp-client", "mcp-cli", "mcp-tool", "mcp-tools",
  "mcp-toolkit", "mcp-integration", "mcp-host", "mcp-resource", "mcp-prompt",
  "mcp-stdio", "mcp-transport", "model-context-protocol", "modelcontextprotocol",
  "anthropic-mcp", "mcp-ai", "mcp-agent", "mcp-agents", "mcp-context",
  "mcp-code", "mcp-codebase", "mcp-code-graph", "mcp-static-analysis",
  "mcp-developer-tools", "mcp-ecosystem", "mcp-plugin", "mcp-extension",
  "mcp-connector", "remote-mcp", "local-mcp", "mcp-registry", "mcp-app",
];
add(mcp);

// 3) AI coding agents / assistants (by name) -------------------------------
const agents = [
  "claude", "claude-ai", "claude-code", "claude-desktop", "anthropic",
  "anthropic-claude", "cursor", "cursor-ai", "cursor-ide", "codex",
  "openai-codex", "codex-cli", "windsurf", "windsurf-ide", "codeium",
  "cline", "continue", "continue-dev", "aider", "github-copilot", "copilot",
  "copilot-chat", "roo-code", "roo-cline", "kilo-code", "zed", "zed-editor",
  "zed-ai", "tabnine", "sourcegraph", "sourcegraph-cody", "cody", "amp-code",
  "augment", "augment-code", "devin", "cognition-devin", "replit", "replit-ai",
  "replit-agent", "bolt", "bolt-new", "lovable", "v0", "vercel-v0", "gemini-cli",
  "google-gemini", "gemini-code-assist", "qwen-coder", "kiro", "trae", "trae-ai",
  "pear-ai", "pearai", "void-editor", "jetbrains-ai", "jetbrains-assistant",
  "warp", "warp-terminal", "openhands", "opendevin", "goose", "block-goose",
];
add(agents);

// 4) AI / LLM / agentic terms ---------------------------------------------
const ai = [
  "ai", "artificial-intelligence", "llm", "llms", "large-language-model",
  "large-language-models", "generative-ai", "genai", "gen-ai", "foundation-model",
  "ai-agent", "ai-agents", "agent", "agents", "agentic", "agentic-ai",
  "agentic-coding", "agentic-workflow", "autonomous-agent", "autonomous-coding",
  "ai-coding", "ai-coding-agent", "ai-coding-assistant", "ai-coding-tools",
  "ai-developer-tools", "ai-dev-tools", "ai-pair-programming", "ai-pair-programmer",
  "pair-programming", "coding-agent", "coding-assistant", "code-assistant",
  "code-completion", "ai-code-completion", "ai-assistant", "ai-tooling",
  "ai-tools", "ai-powered", "ai-native", "llm-tools", "llm-agent", "llm-agents",
  "llm-application", "llm-app", "llm-tooling", "llm-orchestration", "ai-orchestration",
  "rag", "retrieval-augmented-generation", "code-rag", "retrieval", "grounding",
  "ai-context", "context", "context-engineering", "context-window", "context-management",
  "context-provider", "context-retrieval", "prompt", "prompt-engineering",
  "in-context-learning", "tool-use", "tool-calling", "function-calling",
  "ai-memory", "agent-memory", "code-context", "codebase-context",
];
add(ai);

// 5) Token / cost economics -----------------------------------------------
const tokens = [
  "tokens", "token", "token-usage", "token-cost", "token-savings", "token-saving",
  "save-tokens", "reduce-tokens", "cut-tokens", "fewer-tokens", "token-reduction",
  "token-budget", "token-budgeting", "token-efficient", "token-efficiency",
  "token-optimization", "token-optimized", "token-aware", "context-budget",
  "context-compression", "context-optimization", "prompt-compression",
  "llm-cost", "llm-cost-reduction", "ai-cost", "ai-cost-reduction", "cost-optimization",
  "cheaper-ai", "efficient-context", "minimal-context", "lean-context",
];
add(tokens);

// 6) Static analysis / code intelligence -----------------------------------
const analysis = [
  "static-analysis", "static-code-analysis", "code-analysis", "codebase-analysis",
  "source-code-analysis", "program-analysis", "code-intelligence", "code-intel",
  "semantic-code", "semantic-analysis", "code-navigation", "go-to-definition",
  "code-search", "codebase-search", "semantic-search", "code-understanding",
  "codebase-understanding", "code-comprehension", "code-exploration",
  "codebase-exploration", "code-discovery", "symbol-search", "symbol-index",
  "symbols", "symbol-table", "definitions", "references", "find-references",
  "ast", "abstract-syntax-tree", "parser", "parsing", "tree-sitter",
  "incremental-parsing", "lexer", "syntax-tree", "cst", "concrete-syntax-tree",
  "lsp", "language-server", "language-server-protocol", "indexing", "code-indexing",
  "code-index", "repo-indexing", "codebase-indexing",
];
add(analysis);

// 7) Graph terms -----------------------------------------------------------
const graph = [
  "graph", "graphs", "dependency-graph", "dependency-analysis", "dependencies",
  "import-graph", "import-analysis", "module-graph", "call-graph", "callgraph",
  "control-flow-graph", "data-flow", "data-flow-analysis", "symbol-graph",
  "reference-graph", "graph-analysis", "graph-algorithms", "graph-database",
  "graph-query", "pagerank", "page-rank", "centrality", "ranking", "ranked",
  "graph-ranking", "graph-traversal", "directed-graph", "edges", "nodes",
  "neighborhood", "subgraph", "impact-analysis", "blast-radius", "reachability",
];
add(graph);

// 8) Visualization ---------------------------------------------------------
const viz = [
  "visualization", "code-visualization", "codebase-visualization",
  "code-visualisation", "codebase-visualisation", "graph-visualization",
  "dependency-visualization", "architecture-visualization", "software-visualization",
  "code-viewer", "graph-viewer", "code-explorer", "interactive-visualization",
  "3d-visualization", "three-js", "threejs", "webgl", "react-three-fiber",
  "data-visualization", "diagram", "code-diagram", "architecture-diagram",
];
add(viz);

// 9) Developer tooling -----------------------------------------------------
const devtools = [
  "developer-tools", "devtools", "developer-experience", "devx", "dx",
  "cli", "cli-tool", "command-line", "command-line-tool", "command-line-interface",
  "terminal", "terminal-tool", "productivity", "developer-productivity",
  "engineering-productivity", "software-engineering", "software-development",
  "programming", "programming-tools", "coding", "coding-tools", "build-tools",
  "automation", "developer-workflow", "devtool", "sdk", "api", "library",
  "toolkit", "framework", "utility", "open-source", "oss",
];
add(devtools);

// 10) Use cases ------------------------------------------------------------
const usecases = [
  "refactoring", "refactor", "code-refactoring", "code-review", "code-reviews",
  "ai-code-review", "debugging", "debug", "bug-finding", "onboarding",
  "developer-onboarding", "codebase-onboarding", "legacy-code", "legacy-modernization",
  "code-migration", "modernization", "monorepo", "monorepos", "large-codebase",
  "large-codebases", "enterprise-codebase", "polyglot", "polyglot-codebase",
  "dead-code", "dead-code-detection", "unused-code", "code-quality",
  "technical-debt", "tech-debt", "maintainability", "code-metrics", "complexity",
  "code-complexity", "hotspots", "churn", "architecture", "software-architecture",
  "system-design", "architecture-analysis", "documentation", "code-documentation",
  "auto-documentation", "codebase-documentation", "code-summary", "code-summarization",
];
add(usecases);

// 11) Privacy / local-first ------------------------------------------------
const privacy = [
  "local-first", "local", "offline", "offline-first", "privacy", "privacy-first",
  "private", "secure", "no-cloud", "cloudless", "self-hosted", "selfhosted",
  "on-device", "on-premise", "on-prem", "read-only", "no-network", "network-free",
  "no-embeddings", "embedding-free", "no-llm", "llm-free", "deterministic",
  "reproducible", "fast", "lightweight", "zero-config", "single-binary",
];
add(privacy);

// 12) Languages (search reach) --------------------------------------------
const langs = [
  "javascript", "typescript", "tsx", "jsx", "ecmascript", "python", "java",
  "go", "golang", "rust", "c", "cpp", "c-plus-plus", "c-sharp", "csharp",
  "dotnet", "ruby", "php", "swift", "kotlin", "scala", "dart", "elixir",
  "erlang", "haskell", "ocaml", "fsharp", "clojure", "lua", "perl", "r-lang",
  "julia", "objective-c", "groovy", "solidity", "zig", "nim", "crystal",
  "bash", "shell", "powershell", "sql", "graphql", "html", "css", "vue-lang",
];
add(langs);

// 13) Stacks / runtimes (people search by their stack) ---------------------
const stacks = [
  "node", "nodejs", "node-js", "deno", "bun", "npm", "npm-package",
  "react", "reactjs", "nextjs", "next-js", "vue", "vuejs", "angular", "svelte",
  "sveltekit", "solidjs", "express", "expressjs", "nestjs", "fastify", "remix",
  "astro", "django", "flask", "fastapi", "rails", "ruby-on-rails", "laravel",
  "spring", "spring-boot", "dotnet-core", "android", "ios", "flutter",
  "react-native", "web-development", "backend", "frontend", "fullstack",
];
add(stacks);

// 14) Editors / IDEs -------------------------------------------------------
const editors = [
  "vscode", "vs-code", "visual-studio-code", "vscode-extension", "neovim",
  "nvim", "vim", "emacs", "sublime-text", "jetbrains", "intellij", "intellij-idea",
  "pycharm", "webstorm", "phpstorm", "goland", "rider", "clion", "rubymine",
  "datagrip", "ide", "ide-integration", "editor", "code-editor", "text-editor",
];
add(editors);

// 15) Combinatorial: agent-targeted MCP terms (high search value) ----------
const targetAgents = [
  "claude-code", "claude", "cursor", "codex", "windsurf", "cline", "copilot",
  "codeium", "aider", "zed", "continue", "roo-code", "kilo-code", "gemini-cli",
  "trae", "kiro", "warp", "augment", "tabnine", "sourcegraph",
];
for (const a of targetAgents) {
  add(`${a}-mcp`, `mcp-for-${a}`, `${a}-mcp-server`, `${a}-tools`,
      `${a}-context`, `${a}-tokens`, `${a}-extension`, `${a}-plugin`,
      `${a}-integration`, `${a}-code-graph`);
}

// 16) Combinatorial: language-targeted analysis terms ----------------------
const targetLangs = [
  "javascript", "typescript", "python", "go", "rust", "java", "csharp",
  "ruby", "php", "cpp", "kotlin", "swift",
];
for (const l of targetLangs) {
  add(`${l}-code-graph`, `${l}-static-analysis`, `${l}-dependency-graph`,
      `${l}-call-graph`, `${l}-ast`, `${l}-code-analysis`,
      `${l}-codebase`, `${l}-tree-sitter`);
}

// 17) Misc adjacent --------------------------------------------------------
add(
  "code-search-engine", "repository-analysis", "repo-analysis", "git", "github",
  "source-graph", "code-browser", "structure", "code-structure", "architecture-map",
  "wayfinding", "codebase-navigation", "codebase-insights", "engineering-insights",
  "ai-engineering", "context7-alternative", "code-context-protocol",
  "anchors", "path-line-anchors", "skeleton", "code-skeleton", "ranked-context",
  "budgeted-context", "graph-rag", "graphrag", "code-graph-rag",
);

const keywords = [...out].sort();

if (process.argv.includes("--write")) {
  const targets = {
    "mcp/package.json": keywords, // full set on the primary published package
    "core/package.json": keywords.filter((k) =>
      !editors.includes(k) && !stacks.includes(k)), // engine: drop IDE/stack noise
    "viewer/package.json": [
      ...viz, ...graph.slice(0, 12), "openvisio", "code-graph",
      "codebase-visualization", "three-js", "webgl", "react", "viewer",
    ].map(norm),
  };
  for (const [rel, kws] of Object.entries(targets)) {
    const p = join(root, rel);
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    pkg.keywords = [...new Set(kws)].sort();
    writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`wrote ${kws.length} keywords -> ${rel}`);
  }
}

console.log(`total unique keywords (primary set): ${keywords.length}`);
