import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const require = createRequire(import.meta.url)
const plotEntry = require.resolve('jsxgraph')
const plotSource = await readFile(plotEntry, 'utf8')
const plotGlobal = 'window.JXG = JXG;'
if (plotSource.split(plotGlobal).length !== 2) throw new Error('JSXGraph 入口的全局赋值已变化')
const plotLicense = await readFile(resolve(dirname(plotEntry), '../LICENSE.MIT'), 'utf8')
const plotNotice = '/*! JSXGraph\n' + plotLicense + '\n*/\n'
const plotLocal = {
  name: 'atlas-local-jsxgraph',
  setup({ onLoad }) {
    onLoad({ filter: /[\\/]jsxgraph[\\/]src[\\/]index\.js$/ }, ({ path }) => ({
      contents: plotSource.replace(plotGlobal, ''),
      loader: 'js',
      resolveDir: dirname(path),
    }))
  },
}
const katexCssPath = require.resolve('katex/dist/katex.min.css')
const upstreamCss = await readFile(katexCssPath, 'utf8')
const katexLicense = await readFile(resolve(dirname(katexCssPath), '../LICENSE'), 'utf8')
const css = upstreamCss.replace(/([^{}]+)\{([^{}]*)\}/g, (_rule, selector, declarations) => {
  if (selector.trim() === '@font-face') {
    const woff2 = /url\([^)]+\.woff2\)\s*format\(["']woff2["']\)/.exec(declarations)?.[0]
    if (!woff2) throw new Error('KaTeX 字体样式缺少 WOFF2')
    return '@font-face{' + declarations.replace(/src:[^;]+/, 'src:' + woff2) + '}'
  }
  return selector.split(',').map(part => '.dsh-atlas ' + part.trim()).join(',') + '{' + declarations + '}'
})
const mathStyles = await build({
  stdin: { contents: css, loader: 'css', resolveDir: dirname(katexCssPath) },
  bundle: true, minify: true, write: false, loader: { '.woff2': 'dataurl' },
})
const mathCss = '/*! KaTeX\n' + katexLicense + '\n*/\n' +
  mathStyles.outputFiles[0].text.replaceAll('KaTeX_', 'DSHAtlasKaTeX_')
for (const target of mathCss.matchAll(/url\(([^)]+)\)/g)) {
  if (!/^["']?data:/.test(target[1])) throw new Error('KaTeX 样式存在未内嵌资源')
}
const offline = await build({
  entryPoints: ['src/client/offline.tsx'], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2023', jsx: 'automatic', minify: true,
  define: { '__NOTE_MATH_CSS__': JSON.stringify(mathCss), 'process.env.NODE_ENV': '"production"', '__OFFLINE_VIEWER__': '""' },
  plugins: [plotLocal],
  banner: { js: plotNotice },
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
  plugins: [plotLocal],
  define: { '__NOTE_MATH_CSS__': JSON.stringify(mathCss), 'process.env.NODE_ENV': '"production"', '__OFFLINE_VIEWER__': JSON.stringify(offline.outputFiles[0].text) },
  loader: { '.css': 'text' },
  banner: { js: plotNotice + `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
