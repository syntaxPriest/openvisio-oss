import { z } from 'zod'

// ---------- Core data model (mirrors CLAUDE.md §4) ----------

export const LanguageSchema = z.enum([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'ruby',
  'c',
  'cpp',
  'csharp',
  'php',
  'twig',
  'blade',
  'kotlin',
  'swift',
  'scala',
  'lua',
  'bash',
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
  'dart',
  'elixir',
  'ocaml',
  'solidity',
  'zig',
  'r',
  'elm',
  'rescript',
  'tlaplus',
  'objc',
  'embedded_template',
  'systemrdl',
  'ql',
  'elisp',
  'json',
  'yaml',
  'toml',
  'markdown',
  'sql',
  'graphql',
  'eda',
  'other',
])
export type Language = z.infer<typeof LanguageSchema>

export const FileSchema = z.object({
  id: z.number(),
  repo_id: z.string(),
  path: z.string(),
  // .catch keeps an unrecognised language (e.g. one the engine learns before the
  // UI does) from failing the whole graph parse — it just renders as 'other'.
  language: LanguageSchema.catch('other'),
  loc: z.number(),
  sha: z.string(),
  last_modified: z.number(),
})
export type File = z.infer<typeof FileSchema>

export const SymbolKindSchema = z.enum(['function', 'class', 'const', 'type', 'interface'])
export type SymbolKind = z.infer<typeof SymbolKindSchema>

export const SymbolSchema = z.object({
  id: z.number(),
  file_id: z.number(),
  name: z.string(),
  kind: SymbolKindSchema,
  start_line: z.number(),
  end_line: z.number(),
  is_exported: z.boolean(),
})
export type Symbol = z.infer<typeof SymbolSchema>

export const EdgeKindSchema = z.enum(['import', 'call', 'extends', 'implements'])
export type EdgeKind = z.infer<typeof EdgeKindSchema>

export const NodeKindSchema = z.enum(['file', 'symbol'])
export type NodeKind = z.infer<typeof NodeKindSchema>

export const EdgeSchema = z.object({
  id: z.number(),
  source_id: z.number(),
  target_id: z.number(),
  source_kind: NodeKindSchema,
  target_kind: NodeKindSchema,
  edge_kind: EdgeKindSchema,
  weight: z.number().default(1),
})
export type Edge = z.infer<typeof EdgeSchema>

export const FileHistorySchema = z.object({
  file_id: z.number(),
  commits_30d: z.number(),
  commits_90d: z.number(),
  authors_90d: z.number(),
})
export type FileHistory = z.infer<typeof FileHistorySchema>

export const CouplingSchema = z.object({
  file_a_id: z.number(),
  file_b_id: z.number(),
  co_changes: z.number(),
})
export type Coupling = z.infer<typeof CouplingSchema>

// ---------- Repo summary (frontend-only convenience) ----------

export const RepoSummarySchema = z.object({
  repo_id: z.string(),
  name: z.string(),
  root_path: z.string(),
  file_count: z.number(),
  total_loc: z.number(),
  languages: z.array(z.object({ language: LanguageSchema.catch('other'), file_count: z.number() })),
  indexed_at: z.number(),
})
export type RepoSummary = z.infer<typeof RepoSummarySchema>

// ---------- /index — indexing job ----------

export const IndexStageSchema = z.enum([
  'walk',
  'parse',
  'resolve',
  'graph',
  'git',
  'chunk',
  'embed',
  'store',
  'ready',
])
export type IndexStage = z.infer<typeof IndexStageSchema>

export const IndexJobSchema = z.object({
  job_id: z.string(),
  repo_id: z.string(),
  status: z.enum(['queued', 'running', 'complete', 'failed']),
  stage: IndexStageSchema,
  progress: z.number().min(0).max(1),
  message: z.string().optional(),
  error: z.string().optional(),
})
export type IndexJob = z.infer<typeof IndexJobSchema>

// ---------- /graph — graph slice ----------

export const GraphScopeSchema = z.object({
  kind: z.enum(['all', 'folder', 'file']),
  value: z.string().optional(),
  depth: z.number().int().min(1).max(5).default(2),
})
export type GraphScope = z.infer<typeof GraphScopeSchema>

export const LayoutNodeSchema = z.object({ id: z.number(), x: z.number(), y: z.number() })
export type LayoutNode = z.infer<typeof LayoutNodeSchema>

export const GraphResponseSchema = z.object({
  repo: RepoSummarySchema,
  files: z.array(FileSchema),
  symbols: z.array(SymbolSchema),
  edges: z.array(EdgeSchema),
  history: z.array(FileHistorySchema).default([]),
  coupling: z.array(CouplingSchema).default([]),
  // Precomputed deterministic 2D positions (file id → x,y) from the engine. The
  // viewer renders these directly instead of running a client-side force sim.
  layout: z.object({ nodes: z.array(LayoutNodeSchema) }).optional(),
})
export type GraphResponse = z.infer<typeof GraphResponseSchema>

// ---------- Group graph (architecture view) ----------
// Higher-level lens: every folder/module is a single node, edges are the
// aggregated imports between modules.

export const GroupNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().default(''),
  type: z.literal('group'),
  memberCount: z.number(),
  members: z.array(z.string()).default([]),
  size: z.number().default(100),
  color: z.string().default('gray'),
})
export type GroupNode = z.infer<typeof GroupNodeSchema>

export const GroupEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.literal('imports'),
  label: z.string().default(''),
  importCount: z.number().default(0),
  importedProperties: z.array(z.string()).default([]),
})
export type GroupEdge = z.infer<typeof GroupEdgeSchema>

export const GroupGraphResponseSchema = z.object({
  elements: z.object({
    nodes: z.array(z.object({ data: GroupNodeSchema })),
    edges: z.array(z.object({ data: GroupEdgeSchema })),
  }),
  summary: z.string().default(''),
})
export type GroupGraphResponse = z.infer<typeof GroupGraphResponseSchema>

// ---------- /search — semantic search ----------

export const SearchHitSchema = z.object({
  id: z.string(),
  file_path: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  symbol_name: z.string().nullable(),
  snippet: z.string(),
  score: z.number(),
})
export type SearchHit = z.infer<typeof SearchHitSchema>

export const SearchResponseSchema = z.object({
  query: z.string(),
  hits: z.array(SearchHitSchema),
})
export type SearchResponse = z.infer<typeof SearchResponseSchema>

// ---------- /explain — narrator stream ----------

export const CitationSchema = z.object({
  file_path: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  symbol_name: z.string().nullable(),
})
export type Citation = z.infer<typeof CitationSchema>

export type ExplainEvent =
  | { type: 'token'; delta: string }
  | { type: 'citation'; index: number; citation: Citation }
  | { type: 'done' }
  | { type: 'error'; error: string }

export const ExplainRequestSchema = z.object({
  repo_id: z.string(),
  message: z.string(),
  focused_path: z.string().nullable(),
  selected_paths: z.array(z.string()).default([]),
})
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>

// ---------- /ask — structured feature breakdown ----------

export const AskModeSchema = z.enum(['explain', 'trace', 'deep'])
export type AskMode = z.infer<typeof AskModeSchema>

export const AskFileRoleSchema = z.enum([
  'entry-point',
  'implementation',
  'config',
  'data',
  'ui',
  'test',
  'support',
])
export type AskFileRole = z.infer<typeof AskFileRoleSchema>

export const AskFileSchema = z.object({
  path: z.string(),
  role: AskFileRoleSchema,
  note: z.string().optional(),
})
export type AskFile = z.infer<typeof AskFileSchema>

export const AskFolderSchema = z.object({
  name: z.string(),
  note: z.string().optional(),
})
export type AskFolder = z.infer<typeof AskFolderSchema>

export const AskEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  reason: z.string().optional(),
})
export type AskEdge = z.infer<typeof AskEdgeSchema>

export const AskResultSchema = z.object({
  summary: z.string(),
  explanation: z.string(),
  files: z.array(AskFileSchema),
  folders: z.array(AskFolderSchema),
  edges: z.array(AskEdgeSchema),
  agentPrompt: z.string(),
  ai: z.boolean(),
})
export type AskResult = z.infer<typeof AskResultSchema>

export const AskRequestSchema = z.object({
  repo_id: z.string(),
  query: z.string(),
  mode: AskModeSchema.default('explain'),
})
export type AskRequest = z.infer<typeof AskRequestSchema>
