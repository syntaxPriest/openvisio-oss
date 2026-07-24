// UTF-16 conversion fixture. Deliberately mixes an astral emoji (surrogate pair,
// 2 UTF-16 units), CJK (1 unit each), and a combining mark (base + U+0301, 2
// units) ABOVE and WITHIN the lines we assert on — the exact conditions under
// which a byte-based offset silently drifts the column. Positions below are
// hand-verified UTF-16 code-unit offsets. Reused by the T1b range tests.

// L0: const a = 1
// L1: const 🚩 = "x"      🚩 = U+1F6A9 (surrogate pair, 2 units)
// L2: let 中文 = 42
// L3: const café = 7      é written as 'e' + U+0301 combining acute (2 units)
// L4: end
export const source = 'const a = 1\nconst 🚩 = "x"\nlet 中文 = 42\nconst café = 7\nend'

/** Expected UTF-16 offset at which each line begins. */
export const expectedLineStarts = [0, 12, 27, 39, 55]

/** offset (whole-file, UTF-16) → expected 0-based Position. Each is a regression
 *  guard: a byte-based implementation produces different `character` values. */
export const cases: { offset: number; line: number; character: number; note: string }[] = [
  { offset: 0, line: 0, character: 0, note: 'start of file' },
  { offset: 6, line: 0, character: 6, note: 'ascii identifier `a` line' },
  { offset: 18, line: 1, character: 6, note: 'start of 🚩 (surrogate pair)' },
  { offset: 20, line: 1, character: 8, note: 'space AFTER 🚩 — proves emoji counts as 2 units' },
  { offset: 31, line: 2, character: 4, note: 'CJK 中' },
  { offset: 34, line: 2, character: 7, note: '`=` on the CJK line' },
  { offset: 49, line: 3, character: 10, note: 'combining acute after café' },
  { offset: 51, line: 3, character: 12, note: '`=` after café (combining mark counted)' },
  { offset: 55, line: 4, character: 0, note: 'start of last line `end`' },
]
