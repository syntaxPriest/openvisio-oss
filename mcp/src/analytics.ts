import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import pkg from '../package.json' with { type: 'json' }

const FLUSH_INTERVAL_MS = 3600_000
const MAX_BATCH_SIZE = 500
const FINAL_FLUSH_TIMEOUT_MS = 5_000
const RECOVERY_DEBOUNCE_MS = 60_000

const PKG_VERSION: string = pkg.version

export interface TelemetryRecord {
  v: string
  tool: string
  ts: number
  latencyMs: number
  resultSize: number
  repoHash: string
  hash: string
}

interface BufferedRecord {
  v: string
  tool: string
  ts: number
  latencyMs: number
  resultSize: number
  repoHash: string
  hash: string
}

function computeHash(tool: string, latencyMs: number, resultSize: number): string {
  return createHash('sha512')
    .update(tool + String(latencyMs % 100) + String(resultSize))
    .digest('hex')
}

export interface FileBufferedTelemetryOpts {
  bufferDir: string
  repoHash: string
  endpointUrl: string
}

export class FileBufferedTelemetry {
  private bufferPath: string
  private repoHash: string
  private endpointUrl: string
  private flushing = false
  private intervalHandle: ReturnType<typeof setInterval> | undefined
  private closed = false
  private lastFlushTs = 0

  constructor(opts: FileBufferedTelemetryOpts) {
    this.bufferPath = path.join(opts.bufferDir, 'log.jsonl')
    this.repoHash = opts.repoHash
    this.endpointUrl = opts.endpointUrl

    fs.mkdirSync(opts.bufferDir, { recursive: true })

    const leftover = this.countLines()
    if (leftover > 0) {
      const ago = Date.now() - this.getFileMtime()
      if (ago >= RECOVERY_DEBOUNCE_MS) {
        this.scheduleFlush(100)
      }
    }

    this.intervalHandle = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    this.intervalHandle.unref()
  }

  record(tool: string, latencyMs: number, resultSize: number): void {
    const rec: BufferedRecord = {
      v: PKG_VERSION,
      tool,
      ts: Date.now(),
      latencyMs,
      resultSize,
      repoHash: this.repoHash,
      hash: computeHash(tool, latencyMs, resultSize),
    }
    try {
      fs.appendFileSync(this.bufferPath, JSON.stringify(rec) + '\n', { flag: 'as' })
    } catch {
      // best-effort
    }
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
    await this.flushWithTimeout(FINAL_FLUSH_TIMEOUT_MS)
  }

  private scheduleFlush(delayMs: number): void {
    setTimeout(() => { void this.flush() }, delayMs)
  }

  private countLines(): number {
    try {
      const content = fs.readFileSync(this.bufferPath, 'utf8')
      if (content.length === 0) return 0
      return content.split('\n').filter(Boolean).length
    } catch {
      return 0
    }
  }

  private getFileMtime(): number {
    try {
      return fs.statSync(this.bufferPath).mtimeMs
    } catch {
      return 0
    }
  }

  private readRecords(): BufferedRecord[] {
    try {
      const content = fs.readFileSync(this.bufferPath, 'utf8')
      if (!content) return []
      const lines = content.split('\n').filter(Boolean)
      const records: BufferedRecord[] = []
      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as BufferedRecord)
        } catch {
          // skip malformed lines
        }
      }
      return records
    } catch {
      return []
    }
  }

  private async flushWithTimeout(timeoutMs: number): Promise<void> {
    const result = this.flush()
    const timer = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    })
    try {
      await Promise.race([result, timer])
    } catch {
      // timeout — move on
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    this.lastFlushTs = Date.now()
    try {
      const records = this.readRecords()
      if (records.length === 0) return

      const batch = records.slice(0, MAX_BATCH_SIZE)

      await this.upload(batch)

      if (!this.closed) {
        const remaining = records.slice(MAX_BATCH_SIZE)
        const content = remaining.map((r) => JSON.stringify(r)).join('\n') + (remaining.length > 0 ? '\n' : '')
        fs.writeFileSync(this.bufferPath, content, 'utf8')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`openvisio telemetry: flush failed (${msg})\n`)
    } finally {
      this.flushing = false
    }
  }

  private async upload(records: BufferedRecord[]): Promise<void> {
    const body = JSON.stringify(records)
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const res = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      if (!this.closed) {
        fs.truncateSync(this.bufferPath, 0)
      }
    } finally {
      clearTimeout(t)
    }
  }
}
