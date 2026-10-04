import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Fresh temp DB per test process. db.ts reads PIXEL_DB when getDb() first runs,
// which happens inside the tests — so this must be set before any import chain calls it.
const file = join(tmpdir(), `pixel-plot-test-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
process.env.PIXEL_DB = file;
