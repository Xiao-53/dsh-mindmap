import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlugin } from './build.mjs'

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const rootFile = path => new URL(`../${path}`, import.meta.url)

const manifest = JSON.parse(await readFile(rootFile('package.json'), 'utf8'))
const patch = await readFile(rootFile('cordis.yml'), 'utf8')
const escapedName = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const namePattern = new RegExp(`^(\\s*name:\\s*)(?:${JSON.stringify(manifest.name)}|'${escapedName}'|${escapedName})(\\s*)$`, 'm')
if (!namePattern.test(patch)) {
  throw new Error('Cordis 配置中的插件包名与 package.json 不一致')
}

if (typeof manifest.version !== 'string' || !semverPattern.test(manifest.version)) {
  throw new Error(`package.json 版本号 "${manifest.version}" 不符合 SemVer 规范；预发布版本请使用连字符（如 0.4.5-preview.1）`)
}

const rawArgs = process.argv.slice(2)
let allowExistingTag = false
let isDryRun = false
let explicitDestination
const forwardArgs = []

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i]
  if (arg === '--allow-existing-tag') {
    allowExistingTag = true
    continue
  }
  if (arg === '--dry-run') {
    isDryRun = true
  } else if (arg === '--pack-destination') {
    if (i + 1 >= rawArgs.length || !rawArgs[i + 1].trim()) {
      throw new Error('--pack-destination 缺少目标目录参数')
    }
    explicitDestination = rawArgs[i + 1]
  } else if (arg.startsWith('--pack-destination=')) {
    explicitDestination = arg.slice('--pack-destination='.length)
    if (!explicitDestination.trim()) {
      throw new Error('--pack-destination 缺少目标目录参数')
    }
  }
  forwardArgs.push(arg)
}

if (!allowExistingTag) {
  const tagName = `v${manifest.version}`
  const tagVerify = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (!tagVerify.error && tagVerify.status === 0) {
    const tagCommit = spawnSync('git', ['rev-parse', `refs/tags/${tagName}^{commit}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    const headCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    const gitStatus = spawnSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    const mismatch = tagCommit.status !== 0
      || headCommit.status !== 0
      || gitStatus.status !== 0
      || tagCommit.stdout.trim() !== headCommit.stdout.trim()
      || gitStatus.stdout.trim().length > 0
    if (mismatch) {
      throw new Error(
        `版本 ${manifest.version} 已存在正式发布标签 ${tagName}，且当前提交或工作区与之不一致。`
        + '请先在 package.json 升级版本号（如 0.4.5-preview.1）再打包；确需重打该标签版本请附加 --allow-existing-tag。',
      )
    }
  }
}

const isPrerelease = manifest.version.includes('-')
const defaultOutDir = resolve(repoRoot, isPrerelease ? 'dist/previews' : 'dist/releases')
const finalOutDir = explicitDestination !== undefined ? resolve(repoRoot, explicitDestination) : defaultOutDir

const destinationArgs = []
if (!isDryRun) {
  await mkdir(finalOutDir, { recursive: true })
  if (explicitDestination === undefined) {
    destinationArgs.push('--pack-destination', finalOutDir)
  }
}

await buildPlugin(manifest.name)

const packArgs = ['pack', '--ignore-scripts', ...destinationArgs, ...forwardArgs]
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
if (existsSync(npmCli)) {
  execFileSync(process.execPath, [npmCli, ...packArgs], { cwd: repoRoot, stdio: 'inherit' })
} else if (process.platform === 'win32') {
  const quoteCmd = arg => `"${String(arg).replaceAll('"', '""')}"`
  const cmdLine = `"npm.cmd ${packArgs.map(quoteCmd).join(' ')}"`
  execFileSync('cmd.exe', ['/d', '/s', '/c', cmdLine], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsVerbatimArguments: true,
  })
} else {
  execFileSync('npm', packArgs, { cwd: repoRoot, stdio: 'inherit' })
}

if (!isDryRun) {
  const tarballName = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
  const relPath = relative(repoRoot, join(finalOutDir, tarballName)).replaceAll('\\', '/')
  console.log(`已生成插件包: ${relPath}`)
}
