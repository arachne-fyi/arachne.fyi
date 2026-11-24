import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, gzipSync } from 'node:zlib';

/**
 * Append-only NDJSON files, one per UTC day: `<dir>/2026-11-16.ndjson`.
 *
 * These files are the source of truth. A line is written (and fsynced) before the SQLite
 * index is touched, so a crash can lose index rows but never events; the index is
 * rebuilt from here.
 *
 * Files are named by the day the line was *received*, not the event's own timestamp.
 * That keeps every file strictly append-only: a client flushing a week-old offline queue
 * writes to today's file, so old files can be gzipped and never reopened.
 */
export class DayLog {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  static day(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  /** Append lines to the file for `now`'s UTC day and flush them to disk. */
  append(lines: readonly unknown[], now: number): void {
    if (lines.length === 0) return;
    const file = join(this.dir, `${DayLog.day(now)}.ndjson`);
    const fd = openSync(file, 'a');
    try {
      writeSync(fd, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Day files oldest first, plain or gzipped. */
  files(): string[] {
    return readdirSync(this.dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson(\.gz)?$/.test(f))
      .sort()
      .map((f) => join(this.dir, f));
  }

  /** Every parsed line, oldest first. Unparseable lines are reported and skipped. */
  async *read(onBadLine?: (file: string, line: number) => void): AsyncGenerator<unknown> {
    for (const file of this.files()) {
      const stream = file.endsWith('.gz')
        ? createReadStream(file).pipe(createGunzip())
        : createReadStream(file);
      let n = 0;
      for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
        n++;
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line);
        } catch {
          // A torn final line after a crash is the expected case; anything else is worth a look.
          onBadLine?.(file, n);
        }
      }
    }
  }

  /** Gzip day files older than `keepDays`. Returns how many were compressed. */
  compressOld(now: number, keepDays = 2): number {
    const cutoff = DayLog.day(now - keepDays * 86_400_000);
    let done = 0;
    for (const file of this.files()) {
      if (file.endsWith('.gz')) continue;
      const day = file.slice(-17, -7);
      if (day >= cutoff) continue;
      const gz = `${file}.gz`;
      const tmp = `${gz}.tmp`;
      // Write to a temp name and rename, so a crash never leaves a half-written .gz
      // sitting next to a deleted original.
      writeFileSync(tmp, gzipSync(readFileSync(file)));
      renameSync(tmp, gz);
      if (existsSync(gz)) unlinkSync(file);
      done++;
    }
    return done;
  }
}
