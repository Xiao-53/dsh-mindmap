import { build } from 'esbuild'
await build({
  entryPoints: ['tests/support/ui.tsx'],
  outfile: 'node_modules/.cache/dsh-mindmap/ui.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'es2023',
  jsx: 'automatic',
  define: { '__OFFLINE_VIEWER__': '""' },
})
