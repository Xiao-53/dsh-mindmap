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
      createElement: () => ({ textContent: '', remove: () => { styles-- } }),
      head: { append: () => { styles++ } },
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
  ctx.provide('sidebarRight', { mounted: { getSnapshot: () => 's1' } } as any)
  ctx.provide('sidebarRightTabs', { register: () => { activeTabs++; return () => { activeTabs-- } } } as any)
  ctx.provide('remote.workspaceFiles', {} as any)
  ctx.provide('inputTriggers', { registerSource: () => () => {} } as any)
  ctx.provide('conversation', {} as any)
  const binding = { ctx: ctx.extend() }
  let currentBinding: typeof binding | undefined = binding
  let inserted = ''
  binding.ctx.on('slash/input-insert-text', request => { inserted = request.text; return true })
  ctx.provide('sessions', { binding: () => currentBinding } as any)
  try {
    await ctx.plugin(gateway)
    const fiber = ctx.plugin(client)
    await fiber
    assert.equal(activeTabs, 1)
    assert.equal(styles, 1)
    const projected = registration.inject('s1')
    const host = projected.host
    const listing = await host.list(new AbortController().signal)
    assert.equal(listing.maps.length, 0)
    assert.equal(listing.diagnostics.length, 0)
    assert.equal(calls[0].endpoint, 'dshAtlas/request')
    assert.equal(calls[0].workspaceFileScopeId, 's1')
    assert.equal(JSON.parse(calls[0].payload).op, 'list')
    const span = { start:0,end:0,draftRev:1 }
    assert.equal(projected.insertText('可编辑问题草稿', span), true)
    assert.equal(inserted, '可编辑问题草稿')
    currentBinding = undefined
    assert.equal(projected.insertText('不能跨会话插入', span), false)
    assert.equal(inserted, '可编辑问题草稿')
    await fiber.dispose()
    assert.equal(activeTabs, 0)
    assert.equal(styles, 0)
  } finally {
    await ctx.fiber.dispose()
  }
})
