// The single place a stored source offset becomes an editor Position.
//
// OpenVisio stores every range (nameRange, fullRange) as a pair of UTF-16
// code-unit offsets into the file's source. Two empirically verified facts make
// that the correct unit — and make this conversion pure arithmetic with no
// encoding step:
//
//   1. The parser is web-tree-sitter (WASM). Given a JS string, its node offsets
//      (startIndex/endIndex) and row/column are UTF-16 code units — for every
//      node, source.slice(node.startIndex, node.endIndex) === node.text, holding
//      for emoji, CJK, and combining marks alike.
//   2. VS Code's Position.character and TextDocument.positionAt(offset) are ALSO
//      UTF-16 code units.
//
// So a stored offset maps to an editor Position with one line lookup and a
// subtraction — no UTF-8 byte math. Storing BYTE offsets instead would force a
// byte→UTF-16 conversion here and reintroduce the exact column-drift bug that any
// file with an emoji/CJK/accented character above the target column otherwise
// produces. Keep every offset in this codebase UTF-16, and keep this module the
// ONLY converter.

/** 0-based line + 0-based UTF-16 character. Shape-compatible with vscode.Position. */
export interface Position {
  line: number
  character: number
}

/**
 * Convert a whole-file UTF-16 offset to a 0-based {line, character}.
 * `lineStarts[i]` is the UTF-16 offset where line `i` begins; `lineStarts[0]` is
 * always 0 (see {@link computeLineStarts}). O(log n) binary search for the hot
 * cursor / annotation lookup paths. Negative offsets clamp to the start; offsets
 * past EOF resolve on the last line.
 */
export function offsetToPosition(lineStarts: readonly number[], offset: number): Position {
  const n = lineStarts.length
  if (n === 0) return { line: 0, character: Math.max(0, offset) }
  if (offset <= 0) return { line: 0, character: 0 }
  // Greatest i such that lineStarts[i] <= offset.
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((lineStarts[mid] as number) <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo, character: offset - (lineStarts[lo] as number) }
}

/**
 * UTF-16 offsets at which each line starts. `[0]` is always 0; one entry per
 * line. A `\n` (including the `\n` of a `\r\n`) ends the current line and the
 * next line starts after it — matching how editors and tree-sitter count rows.
 * A trailing `\n` yields a final entry for the empty last line, as VS Code models it.
 */
export function computeLineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1)
  }
  return starts
}
