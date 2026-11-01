import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination) throw new Error('Provide the destination for compiled graphics.');
const result = await build({
  entryPoints: [path.join(root, 'web/graphics/index.jsx')],
  bundle: true,
  metafile: true,
  outfile: path.join(destination, 'graphics.js'),
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
  target: ['es2022'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(match[1]);
}
const notices = [];
for (const name of [...packages].sort()) {
  const directory = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  let text = '';
  for (const filename of [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'license',
    'license.md',
    'LICENSE-MIT',
  ]) {
    try {
      text = await readFile(path.join(directory, filename), 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  notices.push(`${name}@${metadata.version} — ${metadata.license || 'See package'}\n${text}`);
}
await writeFile(path.join(destination, 'third-party-notices.txt'), notices.join('\n\n---\n\n'));
