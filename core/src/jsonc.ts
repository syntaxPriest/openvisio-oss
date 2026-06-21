// Tolerant JSON-with-comments parser for tsconfig/jsconfig files: strips `//`
// line comments, `/* */` block comments, and trailing commas before handing the
// result to JSON.parse. String-aware — comment markers and commas inside string
// values are preserved untouched. Shared by the graph builder (path aliases) and
// the scanner (nested-config `exclude` discovery) so there is a single source of
// truth for how we read project config.

export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      continue
    }
    out += c
  }
  const noTrailing = out.replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(noTrailing)
}
