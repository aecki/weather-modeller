import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const file = path.resolve('.cache/graphics-test.cjs');
await mkdir(path.dirname(file), { recursive: true });
try {
  await build({
    entryPoints: ['tests/test_graphics.jsx'],
    outfile: file,
    bundle: true,
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
  });
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally {
  await rm(file, { force: true });
}
