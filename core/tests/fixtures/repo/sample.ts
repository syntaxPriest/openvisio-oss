// Fixture repo for T1b range extraction. The emoji + CJK line sits ABOVE `beta`
// and `Widget`, so a byte-based offset would drift their ranges. UTF-16 offsets
// must still slice to the exact identifier.
export function alpha() {
  return 1
}

const flag = "🚩 banner 中文 café"

export function beta(x: number): number {
  return alpha() + x
}

export class Widget {
  render(): string {
    return 'x'
  }
}
