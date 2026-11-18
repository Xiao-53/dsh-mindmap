import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildPlugin } from './build.mjs'

const legacyName = 'dsh-mindmap'
const rootFile = path => new URL(`../${path}`, import.meta.url)
const manifest = JSON.parse(await readFile(rootFile('package.json'), 'utf8'))
const patch = await readFile(rootFile('cordis.yml'), 'utf8')
const releasePatch = patch.replace(`name: ${JSON.stringify(manifest.name)}`, `name: ${legacyName}`)
if (releasePatch === patch) throw new Error('Cordis 配置中的插件包名与 package.json 不一致')

const { publishConfig, scripts, ...releaseManifest } = manifest
const stagingParent = await realpath(tmpdir())
const stage = await mkdtemp(join(stagingParent, 'dsh-mindmap-release-'))
if (dirname(stage) !== stagingParent) throw new Error('GitHub Release 临时目录路径不正确')
try {
  await buildPlugin(legacyName, join(stage, 'lib'))
  await Promise.all([
    writeFile(join(stage, 'package.json'), JSON.stringify({
      ...releaseManifest,
      name: legacyName,
      private: true,
    }, null, 2) + '\n'),
    writeFile(join(stage, 'cordis.yml'), releasePatch),
    copyFile(rootFile('README.md'), join(stage, 'README.md')),
    copyFile(rootFile('LICENSE'), join(stage, 'LICENSE')),
  ])
  execFileSync(process.execPath, [
    process.env.npm_execpath, 'pack', stage, '--ignore-scripts', ...process.argv.slice(2),
  ], { stdio: 'inherit' })
} finally {
  await rm(stage, { recursive: true, force: true })
}
