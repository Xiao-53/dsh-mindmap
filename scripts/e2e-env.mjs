import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_DSH_FALLBACK = 'C:\\Users\\Xiao\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd'
const DEFAULT_PORT = 3099
const DEFAULT_SESSION = 'dsh-mindmap-e2e'
const DEFAULT_ARTIFACTS = 'test-artifacts'
const ENV_STATE_FILE = 'e2e-env.json'

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'layer1'
  const rest = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv
  const opts = {
    command,
    port: DEFAULT_PORT,
    session: DEFAULT_SESSION,
    artifactsDir: DEFAULT_ARTIFACTS,
    skipBuild: false,
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--skip-build') {
      opts.skipBuild = true
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg.includes('=') ? arg.slice('--port='.length) : rest[++i]
      const port = Number(raw)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`无效端口: ${raw}`)
      opts.port = port
    } else if (arg === '--session' || arg.startsWith('--session=')) {
      const val = arg.includes('=') ? arg.slice('--session='.length) : rest[++i]
      if (!val || !/^[\p{L}\p{N}_-]+$/u.test(val)) throw new Error(`无效 session: ${val}`)
      opts.session = val
    } else if (arg === '--artifacts' || arg.startsWith('--artifacts=')) {
      const val = arg.includes('=') ? arg.slice('--artifacts='.length) : rest[++i]
      if (!val) throw new Error('无效 artifacts 目录')
      opts.artifactsDir = val
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }
  if (!['layer1', 'start', 'serve', 'stop'].includes(opts.command)) {
    throw new Error(`未知子命令: ${opts.command}（支持 layer1 | start | serve | stop）`)
  }
  return opts
}

const quoteCmd = arg => `"${String(arg).replaceAll('"', '""')}"`

function runCommand(exe, args, options = {}) {
  if (/\.(cmd|bat)$/i.test(exe)) {
    const cmdLine = `"${quoteCmd(exe)}${args.length ? ' ' + args.map(quoteCmd).join(' ') : ''}"`
    return spawnSync('cmd.exe', ['/d', '/s', '/c', cmdLine], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
      ...options,
    })
  }
  return spawnSync(exe, args, { encoding: 'utf8', ...options })
}

function resolveFromWhere(name) {
  const res = spawnSync('where.exe', [name], { encoding: 'utf8' })
  if (res.status !== 0 || !res.stdout) return undefined
  for (const line of res.stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed && fs.existsSync(trimmed)) return trimmed
  }
  return undefined
}

function resolveDshCmd() {
  const fromPath = resolveFromWhere('dsh.cmd') ?? resolveFromWhere('dsh')
  if (fromPath && /\.(cmd|exe)$/i.test(fromPath)) return fromPath
  if (fs.existsSync(DEFAULT_DSH_FALLBACK)) return DEFAULT_DSH_FALLBACK
  throw new Error(`未找到 DSH CLI（PATH 及 ${DEFAULT_DSH_FALLBACK} 均不存在）`)
}

function resolveAgentBrowser() {
  const candidates = []
  if (process.env.APPDATA) {
    candidates.push(
      path.join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        'agent-browser',
        'bin',
        'agent-browser-win32-x64.exe',
      ),
    )
  }
  const cmd = resolveFromWhere('agent-browser.cmd')
  if (cmd) {
    candidates.push(
      path.join(path.dirname(cmd), 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe'),
      cmd,
    )
  }
  return candidates.find(candidate => fs.existsSync(candidate))
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

async function ensurePortFree(port) {
  await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', err => reject(new Error(`测试端口 ${port} 已被占用 (${err.code ?? err.message})，可先运行 npm.cmd run verify:e2e:stop`)))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()))
  })
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function seedIsolatedWorkspace(tmpHome) {
  const workspaceDir = path.join(tmpHome, 'e2e-workspace')
  fs.mkdirSync(workspaceDir, { recursive: true })
  const canonicalWorkspace = fs.realpathSync(workspaceDir)
  const now = new Date().toISOString()

  writeJson(path.join(tmpHome, 'storages', 'workspace.json'), {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: 'e2e-workspace',
      workspaceIds: ['e2e-workspace'],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    tables: {
      workspaces: {
        'e2e-workspace': {
          path: canonicalWorkspace,
          title: 'e2e-workspace',
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  })

  const mapsRoot = path.join(canonicalWorkspace, 'dsh-knowledge-maps')
  writeJson(path.join(mapsRoot, 'library.json'), {
    schemaVersion: 1,
    folders: [
      { id: 'folder-alpha', title: '基础学科', parentId: null },
      { id: 'folder-beta', title: '工程实践', parentId: null },
    ],
    mapFolders: { 'e2e-arch': 'folder-beta' },
    rootMapOrder: ['e2e-calculus'],
    folderMapOrders: { 'folder-beta': ['e2e-arch'] },
  })

  writeJson(path.join(mapsRoot, 'e2e-calculus', 'map.json'), {
    schemaVersion: 1,
    id: 'e2e-calculus',
    title: '微积分与物理导图',
    rootViewId: 'root',
    nodes: [
      {
        id: 'n-core',
        title: '核心定理',
        summary: '点击钻取进入子图',
        category: 'blue',
        icon: 'book',
        notePath: 'notes/n-core.md',
        childViewId: 'sub-core',
      },
      {
        id: 'n-math',
        title: '公式与图像',
        summary: 'KaTeX 与 JSXGraph 渲染验证',
        category: 'sage',
        icon: 'atom',
        notePath: 'notes/n-math.md',
      },
      {
        id: 'n-edit',
        title: '可编辑笔记',
        summary: '行内实时编辑初始摘要',
        category: 'terra',
        icon: 'idea',
        notePath: 'notes/n-edit.md',
      },
      {
        id: 'n-sub1',
        title: '极限定义',
        summary: 'ε-δ 语言描述函数极限',
        category: 'plum',
        icon: 'formula',
        notePath: 'notes/n-sub1.md',
      },
      {
        id: 'n-sub2',
        title: '连续性定理',
        summary: '闭区间连续函数的性质',
        category: 'gold',
        icon: 'check',
        notePath: 'notes/n-sub2.md',
      },
    ],
    views: [
      {
        id: 'root',
        title: '总览',
        parentViewId: null,
        groups: [
          { id: 'g1', title: '基础概念', number: '01', category: 'blue' },
          { id: 'g2', title: '进阶分析', number: '02', category: 'sage' },
        ],
        occurrences: [
          { nodeId: 'n-core', groupId: 'g1' },
          { nodeId: 'n-math', groupId: 'g1' },
          { nodeId: 'n-edit', groupId: 'g2' },
        ],
        relationIds: ['r-1', 'r-2'],
      },
      {
        id: 'sub-core',
        title: '核心定理子图',
        parentViewId: 'root',
        centerNodeId: 'n-core',
        groups: [],
        occurrences: [{ nodeId: 'n-sub1' }, { nodeId: 'n-sub2' }],
        relationIds: ['r-sub'],
      },
    ],
    relations: [
      { id: 'r-1', fromNodeId: 'n-core', toNodeId: 'n-math', type: 'dependency', label: '推导' },
      { id: 'r-2', fromNodeId: 'n-math', toNodeId: 'n-edit', type: 'supplement', label: '补充' },
      { id: 'r-sub', fromNodeId: 'n-sub1', toNodeId: 'n-sub2', type: 'dependency' },
    ],
  })

  writeText(
    path.join(mapsRoot, 'e2e-calculus', 'notes', 'n-core.md'),
    '## 核心定理\n\n点击卡片右上指示可钻取到「核心定理子图」。\n',
  )
  writeText(
    path.join(mapsRoot, 'e2e-calculus', 'notes', 'n-sub1.md'),
    '## 极限定义\n\n当 $0 < |x - x_0| < \\delta$ 时，$|f(x) - A| < \\varepsilon$。\n',
  )
  writeText(
    path.join(mapsRoot, 'e2e-calculus', 'notes', 'n-sub2.md'),
    '## 连续性定理\n\n闭区间上的连续函数必有界且取到最值。\n',
  )
  writeText(
    path.join(mapsRoot, 'e2e-calculus', 'notes', 'n-edit.md'),
    '## 编辑前初始正文\n\n这是一段用于验证行内实时编辑与预览的初始内容。\n',
  )

  const trigPlot = JSON.stringify({
    version: 1,
    id: 'plot-trig',
    kind: 'function',
    title: '三角函数曲线',
    xRange: [-6.28, 6.28],
    yRange: [-1.5, 1.5],
    series: [
      { expression: 'sin(x)', label: '正弦' },
      { expression: 'cos(x)', label: '余弦' },
    ],
  }, null, 2)
  const barPlot = JSON.stringify({
    version: 1,
    id: 'plot-bar',
    kind: 'bar',
    title: '季度指标对比',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [{ label: '吞吐', values: [12, 19, 15, 24], unit: 'k/s' }],
  }, null, 2)

  writeText(
    path.join(mapsRoot, 'e2e-calculus', 'notes', 'n-math.md'),
    [
      '## 数学公式与图表渲染',
      '',
      '质能方程 $E = mc^2$ 与麦克斯韦高斯定律 $\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$ 为行内公式。',
      '',
      '$$\\int_0^\\pi \\sin(x)\\,dx = 2$$',
      '',
      '```dsh-plot',
      trigPlot,
      '```',
      '',
      '```dsh-plot',
      barPlot,
      '```',
      '',
    ].join('\n'),
  )

  writeJson(path.join(mapsRoot, 'e2e-arch', 'map.json'), {
    schemaVersion: 1,
    id: 'e2e-arch',
    title: '系统架构导图',
    rootViewId: 'root',
    nodes: [
      {
        id: 'n-arch-1',
        title: '网关入口',
        summary: '统一鉴权与路由分发',
        category: 'blue',
        icon: 'layers',
        notePath: 'notes/n-arch-1.md',
      },
    ],
    views: [
      {
        id: 'root',
        title: '架构总览',
        parentViewId: null,
        groups: [],
        occurrences: [{ nodeId: 'n-arch-1' }],
        relationIds: [],
      },
    ],
    relations: [],
  })
  writeText(
    path.join(mapsRoot, 'e2e-arch', 'notes', 'n-arch-1.md'),
    '## 网关入口\n\n负责请求校验、限流与下游转发。\n',
  )

  return { canonicalWorkspace, mapsRoot }
}

function mountLocalPlugin(dshCmd, repoRoot, tmpHome) {
  const env = { ...process.env, DSH_HOME: tmpHome }
  const initRes = runCommand(dshCmd, ['--profile', 'web', '--dump-config'], { env })
  assert(initRes.status === 0, `初始化临时 web profile 失败: ${initRes.stderr || initRes.stdout}`)

  const webProfileDir = path.join(tmpHome, 'profiles', 'web')
  const scopeDir = path.join(webProfileDir, 'node_modules', '@xiao-53')
  fs.mkdirSync(scopeDir, { recursive: true })
  const linkPath = path.join(scopeDir, 'dsh-mindmap')
  if (!fs.existsSync(linkPath)) fs.symlinkSync(repoRoot, linkPath, 'junction')

  const profilePkgPath = path.join(webProfileDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(profilePkgPath, 'utf8'))
  pkg.dependencies = {
    ...(pkg.dependencies ?? {}),
    '@xiao-53/dsh-mindmap': 'file:' + repoRoot.replaceAll('\\', '/'),
  }
  fs.writeFileSync(profilePkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

  const patchPath = path.join(repoRoot, 'cordis.yml')
  const dumpRes = runCommand(dshCmd, ['--profile', 'web', '--patch', patchPath, '--dump-config'], { env })
  assert(dumpRes.status === 0, `--dump-config 校验失败: ${dumpRes.stderr || dumpRes.stdout}`)
  const stdout = dumpRes.stdout ?? ''
  const stderr = (dumpRes.stderr ?? '').trim()
  assert(
    stdout.includes('id: dsh-mindmap') && stdout.includes('@xiao-53/dsh-mindmap'),
    '--dump-config 未包含 @xiao-53/dsh-mindmap 插件配置',
  )
  assert(!/did not activate|failed to import|\berror:/i.test(stderr), `--dump-config 出现异常告警: ${stderr}`)
  return { env, patchPath }
}

function runBuildAndTypecheck(repoRoot) {
  const npmCmd = resolveFromWhere('npm.cmd') ?? 'npm.cmd'
  const buildRes = runCommand(npmCmd, ['run', 'build'], { cwd: repoRoot })
  assert(buildRes.status === 0, `npm run build 失败:\n${buildRes.stderr}\n${buildRes.stdout}`)
  const tscRes = runCommand(npmCmd, ['run', 'typecheck'], { cwd: repoRoot })
  assert(tscRes.status === 0, `npm run typecheck 失败:\n${tscRes.stderr}\n${tscRes.stdout}`)
}

async function launchDetachedDshWeb(dshCmd, env, patchPath, port, tmpHome, repoRoot) {
  await ensurePortFree(port)
  const outLog = path.join(tmpHome, 'dsh-stdout.log')
  const errLog = path.join(tmpHome, 'dsh-stderr.log')
  const outFd = fs.openSync(outLog, 'w')
  const errFd = fs.openSync(errLog, 'w')

  const args = ['--profile', 'web', '--patch', patchPath, '--no-open', '--port', String(port)]
  const cmdLine = `"${quoteCmd(dshCmd)} ${args.map(quoteCmd).join(' ')}"`
  const child = spawn('cmd.exe', ['/d', '/s', '/c', cmdLine], {
    env,
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', outFd, errFd],
    windowsVerbatimArguments: true,
    windowsHide: true,
  })
  fs.closeSync(outFd)
  fs.closeSync(errFd)

  const tokenPattern = new RegExp(`https?://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`)
  const deadline = Date.now() + 25000
  let tokenUrl
  let exited = false
  child.once('exit', () => { exited = true })

  while (Date.now() < deadline) {
    const outText = fs.existsSync(outLog) ? fs.readFileSync(outLog, 'utf8') : ''
    const match = outText.match(tokenPattern)
    if (match) {
      tokenUrl = match[0]
      break
    }
    if (exited) break
    await new Promise(r => setTimeout(r, 200))
  }

  if (!tokenUrl) {
    const outText = fs.existsSync(outLog) ? fs.readFileSync(outLog, 'utf8') : ''
    const errText = fs.existsSync(errLog) ? fs.readFileSync(errLog, 'utf8') : ''
    killPidTree(child.pid, port)
    throw new Error(`等待 DSH Web 启动 URL 超时或提前退出。\nSTDOUT:\n${outText}\nSTDERR:\n${errText}`)
  }

  await new Promise(r => setTimeout(r, 800))
  const errText = fs.existsSync(errLog) ? fs.readFileSync(errLog, 'utf8') : ''
  if (/did not activate|failed to import|Error \[/i.test(errText)) {
    killPidTree(child.pid, port)
    throw new Error(`DSH 启动日志存在插件加载报错:\n${errText}`)
  }

  child.unref()
  return { pid: child.pid, tokenUrl, outLog, errLog }
}

function killPidTree(pid, port) {
  if (pid) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
  }
  if (port) {
    const netstat = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
    const lineMatch = (netstat.stdout ?? '')
      .split(/\r?\n/)
      .filter(l => l.includes(`127.0.0.1:${port}`) && /\bLISTENING\b/i.test(l))
    for (const line of lineMatch) {
      const listenerPid = Number(line.trim().split(/\s+/).at(-1))
      if (Number.isInteger(listenerPid) && listenerPid > 0) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(listenerPid)], { stdio: 'ignore' })
      }
    }
  }
}

async function removeDirWithRetry(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true })
      return
    } catch {
      await new Promise(r => setTimeout(r, 300))
    }
  }
  fs.rmSync(dirPath, { recursive: true, force: true })
}

async function stopFromState(stateFile, session) {
  const ab = resolveAgentBrowser()
  if (ab) {
    // 严格保留默认 AGENT_BROWSER_SOCKET_DIR，仅优雅关闭当前测试会话。
    runCommand(ab, ['--session', session, 'close'], { stdio: 'ignore' })
  }
  if (!fs.existsSync(stateFile)) return { cleaned: false, reason: 'no active e2e-env.json' }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  killPidTree(state.pid, state.port)
  await removeDirWithRetry(state.tmpHome)
  fs.rmSync(stateFile, { force: true })
  return {
    cleaned: true,
    pid: state.pid,
    port: state.port,
    tempDshHomeRemoved: !fs.existsSync(state.tmpHome),
  }
}

async function launchForegroundDshWeb(dshCmd, env, patchPath, port, tmpHome, repoRoot) {
  await ensurePortFree(port)
  const args = ['--profile', 'web', '--patch', patchPath, '--no-open', '--port', String(port)]
  const cmdLine = `"${quoteCmd(dshCmd)} ${args.map(quoteCmd).join(' ')}"`
  const child = spawn('cmd.exe', ['/d', '/s', '/c', cmdLine], {
    env,
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsVerbatimArguments: true,
    windowsHide: true,
  })

  let stdout = ''
  let stderr = ''
  const tokenPattern = new RegExp(`https?://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`)
  const tokenUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      killPidTree(child.pid, port)
      reject(new Error(`等待 DSH Web 启动 URL 超时 (25s)。\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`))
    }, 25000)

    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      const match = stdout.match(tokenPattern)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`DSH Web 提前退出 (code=${code})。\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`))
    })
  })

  await new Promise(r => setTimeout(r, 800))
  if (/did not activate|failed to import|Error \[/i.test(stderr)) {
    killPidTree(child.pid, port)
    throw new Error(`DSH 启动日志存在插件加载报错:\n${stderr}`)
  }

  return { child, tokenUrl }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const repoRoot = process.cwd()
  const artifactsDir = path.resolve(repoRoot, opts.artifactsDir)
  const stateFile = path.join(artifactsDir, ENV_STATE_FILE)

  if (opts.command === 'stop') {
    const result = await stopFromState(stateFile, opts.session)
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const dshCmd = resolveDshCmd()

  if (opts.command === 'layer1') {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mindmap-e2e-'))
    let launched
    try {
      if (!opts.skipBuild) runBuildAndTypecheck(repoRoot)
      seedIsolatedWorkspace(tmpHome)
      const { env, patchPath } = mountLocalPlugin(dshCmd, repoRoot, tmpHome)
      launched = await launchDetachedDshWeb(dshCmd, env, patchPath, opts.port, tmpHome, repoRoot)
      console.log('[PASS] Layer 1 无头快检（build + typecheck + --dump-config + 隔离 DSH Web 启动日志无异常）')
    } finally {
      killPidTree(launched?.pid, opts.port)
      await removeDirWithRetry(tmpHome)
    }
    return
  }

  // start / serve: 若有未收尾的旧测试实例先清理，随后新建干净 artifacts 目录并拉起隔离 DSH Web
  await stopFromState(stateFile, opts.session)
  fs.rmSync(artifactsDir, { recursive: true, force: true })
  fs.mkdirSync(artifactsDir, { recursive: true })

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mindmap-e2e-'))
  try {
    if (!opts.skipBuild) runBuildAndTypecheck(repoRoot)
    const { canonicalWorkspace, mapsRoot } = seedIsolatedWorkspace(tmpHome)
    const { env, patchPath } = mountLocalPlugin(dshCmd, repoRoot, tmpHome)

    if (opts.command === 'serve') {
      const { child, tokenUrl } = await launchForegroundDshWeb(dshCmd, env, patchPath, opts.port, tmpHome, repoRoot)
      const envState = {
        startedAt: new Date().toISOString(),
        pid: child.pid,
        port: opts.port,
        session: opts.session,
        dshCmd,
        tmpHome,
        workspaceDir: canonicalWorkspace,
        mapsRoot,
        tokenUrl,
      }
      writeJson(stateFile, envState)
      console.log('[PASS] Layer 1 快检通过，隔离 DSH Web 守护运行中:')
      console.log(JSON.stringify(envState, null, 2))

      let cleaning = false
      const cleanupAndExit = async code => {
        if (cleaning) return
        cleaning = true
        killPidTree(child.pid, opts.port)
        await removeDirWithRetry(tmpHome)
        fs.rmSync(stateFile, { force: true })
        process.exit(code)
      }
      process.once('SIGINT', () => { void cleanupAndExit(0) })
      process.once('SIGTERM', () => { void cleanupAndExit(0) })
      await new Promise(resolve => {
        child.stdout.on('data', chunk => process.stdout.write(chunk))
        child.stderr.on('data', chunk => process.stderr.write(chunk))
        child.once('exit', resolve)
      })
      await cleanupAndExit(0)
      return
    }

    const launched = await launchDetachedDshWeb(dshCmd, env, patchPath, opts.port, tmpHome, repoRoot)

    const envState = {
      startedAt: new Date().toISOString(),
      pid: launched.pid,
      port: opts.port,
      session: opts.session,
      dshCmd,
      tmpHome,
      workspaceDir: canonicalWorkspace,
      mapsRoot,
      tokenUrl: launched.tokenUrl,
      stdoutLog: launched.outLog,
      stderrLog: launched.errLog,
    }
    writeJson(stateFile, envState)
    console.log('[PASS] Layer 1 快检通过，隔离 DSH Web 已就绪:')
    console.log(JSON.stringify(envState, null, 2))
  } catch (err) {
    await removeDirWithRetry(tmpHome)
    throw err
  }
}

main().catch(err => {
  console.error(`[E2E ENV ERROR] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
