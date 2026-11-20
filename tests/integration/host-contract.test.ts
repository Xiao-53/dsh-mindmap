import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'
import { posix } from 'node:path'
import { sampleMap } from '../support/maps.ts'
import { requestMethod } from '../../src/shared/rpc.ts'
import manifest from '../../package.json' with { type: 'json' }
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const { TYPERT } = await import(pathToFileURL(resolve('lib/typert.js')).href)
const plugin = await import(pathToFileURL(resolve('lib/index.js')).href)
test('构建后的插件通过真实 Cordis/Typert/Gateway 绑定会话并检查授权', async () => {
  const ctx = new Context()
  new TypertRegistry(ctx)
  ctx.typert.register(validateTypertManifest(manifest.name, TYPERT))
  let denied = false
  const decisions: any[] = []
  ctx.provide('remoteAccess', {
    decide(request: any) {
      decisions.push(request)
      return denied
        ? { kind: 'deny', reason: 'test-denied' }
        : { kind: 'allow' }
    },
  } as any)
  ctx.typert.resources.register('session', { field: 'workspaceFileScopeId' })
  ctx.typert.lookups.register('workspaceFileScope', {
    parameter: 'workspaceFileScope',
    wire: 'workspaceFileScopeId',
    resource: 'session',
    hostTypeSymbol: '@deepseek-ai/dsh-api-workspace-files#WorkspaceFileScope',
    wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
    resolve: async (id) => ({
      sessionId: id,
      workspaceRoot: id === 's1' ? '/one' : '/two',
    }),
  })
  const content = new TextEncoder().encode(JSON.stringify(sampleMap()))
  ctx.provide('fs', {
    resolve: async (path: string, options?: { cwd?: string }) => ({
      targetKey: posix.resolve(options?.cwd ?? '/', path),
      displayPath: path,
    }),
    contains: (a: any, b: any) =>
      b.targetKey === a.targetKey || b.targetKey.startsWith(a.targetKey + '/'),
    lstat: async () => undefined,
    stat: async () => undefined,
  } as any)
  ctx.provide('workspaceFiles', {
    readBytes: async (scope: any, path: string) => ({
      version: '1',
      data: content,
      offset: 0,
      eof: true,
      absolutePath: `${scope.workspaceRoot}/${path}`,
    }),
    stat: async (_scope: any, path: string) => {
      if (path.endsWith('/map.json')) return { version: '1' }
      throw Object.assign(new Error('missing'), {
        code: 'workspace-file/not-found',
      })
    },
  } as any)
  const gateway = new TypertGatewayService(ctx, {})
  plugin.apply(ctx)
  const signal = new AbortController().signal
  const peer = {
    id: 'peer',
    ctx,
    principal: { kind: 'test-peer' },
    signal,
    interactions: 'none',
    dispose: async () => {},
  } as any
  const invoke = async (id: string, payload: object) =>
    gateway.invoke({
      namespace: 'dshAtlas',
      method: 'request',
      args: { workspaceFileScopeId: id, payload: JSON.stringify(payload) },
      peer,
    })
  try {
    const one = JSON.parse(
      (await invoke('s1', { op: 'read', mapId: 'map-a' })) as string,
    )
    const two = JSON.parse(
      (await invoke('s2', { op: 'read', mapId: 'map-a' })) as string,
    )
    assert.equal(one.ok, true)
    assert.equal(two.ok, true)
    assert.equal(one.value.workspaceKey, '/one')
    assert.equal(two.value.workspaceKey, '/two')
    assert.ok(
      decisions.some(
        (d) =>
          d.action === 'dshAtlas/request' &&
          d.resources.some((r: any) => r.kind === 'session' && r.id === 's1'),
      ),
    )
    const bad = JSON.parse(
      (await invoke('s1', { op: 'read', mapId: '../other' })) as string,
    )
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'invalid_data')
    const normalized = JSON.parse(
      (await invoke('s1', {
        op: 'read',
        mapId: 'map-a',
        expectedWorkspaceKey: '/one/',
      })) as string,
    )
    assert.equal(normalized.ok, true)
    const changed = JSON.parse(
      (await invoke('s2', {
        op: 'read',
        mapId: 'map-a',
        expectedWorkspaceKey: '/one',
      })) as string,
    )
    assert.equal(changed.code, 'workspace_changed')
    denied = true
    await assert.rejects(
      invoke('s1', { op: 'read', mapId: 'map-a' }),
      /access denied/,
    )
    const parsed = requestMethod
      .input({ strict: true })
      .create()
      .safeParse({ workspaceFileScopeId: 's1', payload: '{}', extra: true })
    assert.equal(parsed.success, false)
  } finally {
    await ctx.fiber.dispose()
  }
})
