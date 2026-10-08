import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;
const MAX_EVENTS = 1000;

export function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeMusicSessionUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^(?:www\.)?flowmusic\.app$/iu.test(url.hostname) || !/^\/session(?:\/[0-9a-f-]{36})?\/?$/iu.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** Explicitly enabled, bounded local diagnostic writer. It never affects flow control. */
export class MusicObservation {
  private filePath: string | null = null;
  private bytes = 0;
  private events = 0;
  private truncated = false;

  constructor(directory = process.env.FLOW_MUSIC_VALIDATION_DIR) {
    if (!directory || !path.isAbsolute(directory)) return;
    try {
      if (!fs.statSync(directory).isDirectory()) return;
      this.filePath = path.join(directory, `flow-music-observation-${crypto.randomUUID()}.jsonl`);
    } catch {
      this.filePath = null;
    }
  }

  record(event: string, fields: Record<string, unknown>): void {
    if (!this.filePath || this.truncated) return;
    try {
      const line = `${JSON.stringify({ schema: 'flow-music-observation.v1', at: new Date().toISOString(), event, ...fields })}\n`;
      const lineBytes = Buffer.byteLength(line);
      if (this.events >= MAX_EVENTS || this.bytes + lineBytes > MAX_BYTES) {
        const marker = `${JSON.stringify({ schema: 'flow-music-observation.v1', at: new Date().toISOString(), event: 'truncated' })}\n`;
        fs.appendFileSync(this.filePath, marker, { encoding: 'utf8', mode: 0o600 });
        this.truncated = true;
        return;
      }
      fs.appendFileSync(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
      this.events += 1;
      this.bytes += lineBytes;
    } catch {
      // Diagnostic output must not change a paid submission or result binding.
      this.filePath = null;
    }
  }

  get enabled(): boolean {
    return this.filePath !== null;
  }
}
