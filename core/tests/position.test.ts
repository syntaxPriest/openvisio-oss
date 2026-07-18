import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offsetToPosition, computeLineStarts } from '../src/position.js'
import { source, expectedLineStarts, cases } from './fixtures/utf16-sample.js'

// Independent reference: a straight linear scan in UTF-16 code units. Correct by
// construction (it's the definition VS Code's positionAt implements); used to
// fuzz-check the binary-search helper across every offset.
function refPosition(src: string, offset: number): { line: number; character: number } {
  const off = Math.max(0, Math.min(offset, src.length))
  let line = 0
  let lineStart = 0
  for (let i = 0; i < off; i++) {
    if (src.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, character: off - lineStart }
}

test('computeLineStarts matches the hand-verified UTF-16 line offsets', () => {
  assert.deepEqual(computeLineStarts(source), expectedLineStarts)
})

test('hand-verified multibyte cases (emoji / CJK / combining) resolve exactly', () => {
  const lineStarts = computeLineStarts(source)
  for (const c of cases) {
    assert.deepEqual(
      offsetToPosition(lineStarts, c.offset),
      { line: c.line, character: c.character },
      `offset ${c.offset} (${c.note})`,
    )
  }
})

test('fixture case offsets actually land where the notes claim (guards the fixture itself)', () => {
  // Every line start in `cases` with character 0 must sit at a real line boundary.
  for (const c of cases) {
    if (c.character === 0 && c.offset > 0) {
      assert.equal(source.charCodeAt(c.offset - 1), 10, `offset ${c.offset} should follow a \\n`)
    }
  }
})

test('agrees with a linear UTF-16 reference for every in-contract offset', () => {
  // Contract domain is [0, source.length] — tree-sitter node offsets never exceed
  // the source length. Negatives clamp to start; past-EOF is out of contract and
  // covered explicitly below. Within the domain the two implementations must agree.
  const lineStarts = computeLineStarts(source)
  for (let off = -2; off <= source.length; off++) {
    assert.deepEqual(
      offsetToPosition(lineStarts, off),
      refPosition(source, off),
      `offset ${off}`,
    )
  }
})

test('each line start resolves to character 0 on its own line', () => {
  const lineStarts = computeLineStarts(source)
  lineStarts.forEach((start, line) => {
    assert.deepEqual(offsetToPosition(lineStarts, start), { line, character: 0 })
  })
})

test('edge cases: negative, past-EOF, single-line, empty lineStarts', () => {
  const lineStarts = computeLineStarts(source)
  assert.deepEqual(offsetToPosition(lineStarts, -5), { line: 0, character: 0 })
  const last = lineStarts.length - 1
  assert.deepEqual(offsetToPosition(lineStarts, source.length + 100), {
    line: last,
    character: source.length + 100 - expectedLineStarts[last]!,
  })
  assert.deepEqual(offsetToPosition([0], 4), { line: 0, character: 4 })
  assert.deepEqual(offsetToPosition([], 7), { line: 0, character: 7 })
})
