import type { GrammarConfig } from './index.js'

const YAML_SYMBOLS = `
(block_mapping_pair key: (flow_node (plain_scalar (string_scalar) @name))) @def.const
(block_mapping_pair key: (flow_node (double_quote_scalar) @name)) @def.const
`

export const yaml: GrammarConfig = {
  symbolQuery: YAML_SYMBOLS,
  importQuery: null,
  callQuery: undefined,
  keep: (def) => def.parent?.type === 'block_node' || def.parent?.type === 'document',
  exported: () => true,
  importSpecifier: () => '',
  resolveImport: () => null,
}
