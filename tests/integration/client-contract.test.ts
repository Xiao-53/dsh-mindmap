import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'

test('实际客户端产物在严格 Cordis 插件上下文挂载后可从侧栏调用 dshAtlas，卸载清理入口', async () => {
  const ctx = new Context()
  const calls: any[] = []
  let registration: any
  let activeTabs = 0
  let styles = 0
  let client: any
  const require = createRequire(import.meta.url)
  runInNewContext(await readFile('lib/client.js', 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }: any) => {
      client = factory((name: string) => name === '@deepseek-ai/dsh-client-store'
        ? { defineStore: (config: unknown) => config } : require(name))
    } } },
    document: {
      createElement: () => ({ textContent: '', getElementsByTagName: () => [], remove: () => { styles-- } }),
      head: { append: () => { styles++ } },
      documentElement: { style: {} },
    },
    AbortSignal, AbortController, setTimeout, clearTimeout, console,
  })
  new TypertRegistry(ctx)
  ctx.provide('connection', {
    interactions: 'none',
    rpc: {
      open: () => {},
      call: async (_path: string, endpoint: string, payload: any) => {
        calls.push({ endpoint, ...payload.args })
        return { ok: true, value: JSON.stringify({ ok: true, value: { maps: [], diagnostics: [] } }) }
      },
    },
  } as any)
  ctx.provide('slots', {
    inject: (_name: string, callback: () => unknown) => callback(),
    register: (options: any) => { registration = options; return () => { registration = undefined } },
  } as any)
  ctx.provide('sidebarRight', { mounted: { getSnapshot: () => 's1' }, registerCloseHandler: () => () => {} } as any)
  ctx.provide('sidebarRightTabs', { register: () => { activeTabs++; return () => { activeTabs-- } } } as any)
  ctx.provide('remote.workspaceFiles', {} as any)
  ctx.provide('inputTriggers', { registerSource: () => () => {} } as any)
  ctx.provide('conversation', {} as any)
  const binding = { ctx: ctx.extend() }
  ctx.provide('sessions', { binding: () => binding } as any)
  try {
    await ctx.plugin(gateway)
    const fiber = ctx.plugin(client)
    await fiber
    assert.equal(activeTabs, 1)
    assert.equal(styles, 1)
    const manifest = JSON.parse(await readFile('package.json', 'utf8'))
    assert.equal(manifest.dependencies.zod, undefined)
    assert.equal(manifest.peerDependencies.zod, '^4.0.0')
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-session-controller'))
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-store'))
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
    const projected = registration.inject('s1')
    assert.equal('insertText' in projected, false)
    const host = projected.host
    assert.equal(typeof host.cleanupOrphanAssets, 'function')
    assert.equal(typeof host.compactRetired, 'function')
    const listing = await host.list(new AbortController().signal)
    assert.equal(listing.maps.length, 0)
    assert.equal(listing.diagnostics.length, 0)
    assert.equal(calls[0].endpoint, 'dshAtlas/request')
    assert.equal(calls[0].workspaceFileScopeId, 's1')
    assert.equal(JSON.parse(calls[0].payload).op, 'list')
    await fiber.dispose()
    assert.equal(activeTabs, 0)
    assert.equal(styles, 0)
  } finally {
    await ctx.fiber.dispose()
  }
})
