import { createHash } from 'node:crypto'

export function sha512(content: string | Buffer): string {
  return createHash('sha512').update(content).digest('hex')
}
