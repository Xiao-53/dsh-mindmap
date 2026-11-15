import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const offline = await build({
  entryPoints: ['src/client/offline.tsx'], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2023', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"', '__OFFLINE_VIEWER__': '""' },
  loader: { '.css': 'text' },
})

await build({
  entryPoints: {
    index: 'src/index.ts',
    typert: 'src/typert.ts',
  },
  outdir: 'lib',
  bundle: true,
  packages: 'external',
  platform: 'neutral',
  format: 'esm',
  target: 'es2023',
  jsx: 'automatic',
  loader: { '.css': 'text' },
})

// DSH rc.3 的 /plugins 路由装载闭包工厂，不装载普通 ESM。
// 依据官方 packages/client/tsdown.client.ts 及 web/src/platform.ts：
// 只有宿主提供的模块保持 require，其余依赖必须随客户端打包。
await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2023',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', 'zod'],
  define: { 'process.env.NODE_ENV': '"production"', '__OFFLINE_VIEWER__': JSON.stringify(offline.outputFiles[0].text) },
  loader: { '.css': 'text' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
