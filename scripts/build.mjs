import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts', 'src/options.ts'],
  outdir: 'dist', bundle: true, format: 'iife', target: 'chrome120',
});
await cp('public', 'dist', { recursive: true });
