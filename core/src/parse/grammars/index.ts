import type { Node } from 'web-tree-sitter'
import type { GrammarId } from '../treesitter.js'
import { typescript as _typescript, tsx as _tsx } from './typescript.js'
import { javascript as _javascript } from './javascript.js'
import { python as _python } from './python.js'
import { go as _go } from './go.js'
import { rust as _rust } from './rust.js'
import { java as _java } from './java.js'
import { c as _c } from './c.js'
import { cpp as _cpp } from './cpp.js'
import { csharp as _csharp } from './csharp.js'
import { kotlin as _kotlin } from './kotlin.js'
import { ruby as _ruby } from './ruby.js'
import { php as _php } from './php.js'
import { swift as _swift } from './swift.js'
import { scala as _scala } from './scala.js'
import { dart as _dart } from './dart.js'
import { zig as _zig } from './zig.js'
import { lua as _lua } from './lua.js'
import { rLanguage as _rLanguage } from './r.js'
import { elixir as _elixir } from './elixir.js'
import { elm as _elm } from './elm.js'
import { ocaml as _ocaml } from './ocaml.js'
import { rescript as _rescript } from './rescript.js'
import { solidity as _solidity } from './solidity.js'
import { tlaplus as _tlaplus } from './tlaplus.js'
import { objc as _objc } from './objc.js'
import { bash as _bash } from './bash.js'
import { vue as _vue } from './vue.js'
import { html as _html } from './html.js'
import { css as _css } from './css.js'
import { json as _json } from './json.js'
import { yaml as _yaml } from './yaml.js'
import { toml as _toml } from './toml.js'
import { embedded_template as _embedded_template } from './embedded_template.js'
import { systemrdl as _systemrdl } from './systemrdl.js'
import { ql as _ql } from './ql.js'
import { elisp as _elisp } from './elisp.js'

export interface GrammarConfig {
  symbolQuery: string
  importQuery: string | null
  callQuery?: string
  importSpecifier: (node: Node) => string
  keep: (def: Node, name: string) => boolean
  exported: (def: Node, name: string) => boolean
  /**
   * Resolve an import specifier to a repo-relative file path, or null if
   * external/unresolvable. `bySet` is the set of all repo-relative file paths.
   * `tsAliases` is only relevant for TS/JS (tsconfig paths).
   */
  resolveImport: (fromRel: string, spec: string, bySet: Set<string>, tsAliases?: TsAliases) => string | null
}

/** Shared type for tsconfig/jsconfig path alias resolution. */
export interface AliasRule {
  prefix: string
  suffix: string
  targets: string[]
}
export interface TsAliases {
  baseUrl: string
  rules: AliasRule[]
  excludes: string[]
}

export { _typescript as typescript, _tsx as tsx }
export { _javascript as javascript }
export { _python as python }
export { _go as go }
export { _rust as rust }
export { _java as java }
export { _c as c }
export { _cpp as cpp }
export { _csharp as csharp }
export { _kotlin as kotlin }
export { _ruby as ruby }
export { _php as php }
export { _swift as swift }
export { _scala as scala }
export { _dart as dart }
export { _zig as zig }
export { _lua as lua }
export { _rLanguage as rLanguage }
export { _elixir as elixir }
export { _elm as elm }
export { _ocaml as ocaml }
export { _rescript as rescript }
export { _solidity as solidity }
export { _tlaplus as tlaplus }
export { _objc as objc }
export { _bash as bash }
export { _vue as vue }
export { _html as html }
export { _css as css }
export { _json as json }
export { _yaml as yaml }
export { _toml as toml }
export { _embedded_template as embedded_template }
export { _systemrdl as systemrdl }
export { _ql as ql }
export { _elisp as elisp }

export const GRAMMARS: Record<GrammarId, GrammarConfig> = {
  typescript: _typescript,
  tsx: _tsx,
  javascript: _javascript,
  python: _python,
  go: _go,
  rust: _rust,
  java: _java,
  c: _c,
  cpp: _cpp,
  c_sharp: _csharp,
  kotlin: _kotlin,
  ruby: _ruby,
  php: _php,
  swift: _swift,
  scala: _scala,
  dart: _dart,
  zig: _zig,
  lua: _lua,
  r: _rLanguage,
  elixir: _elixir,
  elm: _elm,
  ocaml: _ocaml,
  rescript: _rescript,
  solidity: _solidity,
  tlaplus: _tlaplus,
  objc: _objc,
  bash: _bash,
  vue: _vue,
  html: _html,
  css: _css,
  json: _json,
  yaml: _yaml,
  toml: _toml,
  embedded_template: _embedded_template,
  systemrdl: _systemrdl,
  ql: _ql,
  elisp: _elisp,
}
