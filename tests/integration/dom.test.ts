import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, act, useSyncExternalStore } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { captureSelection } from '../../src/client/selection.ts'
import { MemoryFiles } from '../support/files.ts'
import { readSnapshot } from '../../src/server/map-files.ts'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const { AtlasPane, RenderNote, Icon, createOfflineHtml } = await import(
  pathToFileURL(resolve('node_modules/.cache/dsh-mindmap/ui.mjs')).href
)
import { loadPrototype } from '../support/prototype.ts'
import { runInNewContext } from 'node:vm'

test('所有 14 个节点 SVG 与 v17 元素一致；离线导出不泄露工作区且转义脚本边界', async () => {
  const { html, snapshot } = await loadPrototype()
  const iconSource = html.slice(html.indexOf('const icons='), html.indexOf('function svgIcon'))
  const icons = runInNewContext(`${iconSource};icons`)
  for (const [name, markup] of Object.entries(icons)) {
    const actual = new JSDOM(renderToStaticMarkup(createElement(Icon, { name }))).window.document.querySelector('svg')!
    const expected = new JSDOM(`<svg>${markup}</svg>`).window.document.querySelector('svg')!
    assert.equal(actual.innerHTML, expected.innerHTML, name)
  }
  snapshot.map.title = '</title><script>bad()</script>'
  snapshot.notes.quantum = '</script><script>bad()</script>'
  const exported = createOfflineHtml(snapshot, snapshot.layout, 'root', 'void 0;')
  const document = new JSDOM(exported).window.document
  assert.equal(document.querySelectorAll('script').length, 2)
  assert.equal(document.title, snapshot.map.title)
  assert.equal(JSON.parse(document.querySelector('#atlas-data')!.textContent!).notes.quantum, snapshot.notes.quantum)
  assert.ok(!exported.includes('test-only'))
  assert.ok(!exported.includes('src="http'))
})

test('笔记原始 HTML、脚本、事件及危险协议不执行，合法本地图片经白名单显示', () => {
  const markup = renderToStaticMarkup(
    createElement(RenderNote, {
      nodeId: 'a',
      resources: { 'a:../assets/a.png': 'data:image/png;base64,aGVsbG8=' },
      markdown:
        '## 核心理解\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[坏链接](javascript:alert%281%29)\n\n![本地图](../assets/a.png)\n\nE = mc²',
    }),
  )
  assert.ok(!markup.includes('<script'))
  assert.ok(!markup.includes('<img src="x"'))
  assert.ok(!markup.includes('href="javascript:'))
  assert.ok(markup.includes('&lt;script&gt;'))
  assert.ok(markup.includes('data:image/png;base64'))
  assert.ok(markup.includes('E = mc²'))
})
test('空选区不会沿用历史目标，选区限制在详情内，公式字符与上下文完整', () => {
  const dom = new JSDOM(
    '<div id="note">公式：<b>E = mc²</b>。条件</div><div id="other">无关</div>',
  )
  const doc = dom.window.document
  const box = doc.querySelector<HTMLElement>('#note')!
  const selection = dom.window.getSelection()!
  const range = doc.createRange()
  range.selectNodeContents(box.querySelector('b')!)
  selection.addRange(range)
  const chosen = captureSelection(box, selection)
  assert.equal(chosen?.text, 'E = mc²')
  assert.equal(chosen?.before, '公式：')
  assert.equal(chosen?.after, '。条件')
  selection.removeAllRanges()
  assert.equal(captureSelection(box, selection), undefined)
  range.selectNodeContents(doc.querySelector('#other')!)
  selection.addRange(range)
  assert.equal(captureSelection(box, selection), undefined)
  dom.window.close()
})
test('首期面板实际挂载、加载、搜索、打开/关闭笔记和复制入口可用', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://atlas.test' })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const name of [
    'window',
    'document',
    'HTMLElement',
    'Node',
    'NodeFilter',
    'ResizeObserver',
    'IS_REACT_ACT_ENVIRONMENT',
  ])
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  class Observer {
    callback: (entries: unknown[]) => void
    constructor(callback: (entries: unknown[]) => void) {
      this.callback = callback
    }
    observe() {
      this.callback([{ contentRect: { width: 480, height: 600 } }])
    }
    disconnect() {}
  }
  const replacements = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    ResizeObserver: Observer,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(replacements))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    })
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({ matches: true }),
  })
  Object.defineProperty(
    dom.window.HTMLElement.prototype,
    'getBoundingClientRect',
    {
      value: () => ({
        width: 236,
        height: 100,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 100,
        right: 236,
      }),
    },
  )
  for (const name of ['setPointerCapture','releasePointerCapture'])
    Object.defineProperty(dom.window.HTMLElement.prototype, name, { value: () => {} })
  Object.defineProperty(dom.window.HTMLElement.prototype, 'hasPointerCapture', { value: () => true })
  let snapshot = await readSnapshot(new MemoryFiles(), 'map-a')
  let state: any = { maps: {}, pending: {}, selectedMapId: 'map-a' }
  const listeners = new Set<() => void>()
  const update = (next: any) => {
    state = next
    listeners.forEach((fn) => fn())
  }
  const actions = {
    selectMap: (id: string) => update({ ...state, selectedMapId: id }),
    setReading: (key: string, reading: any) =>
      update({ ...state, maps: { ...state.maps, [key]: reading } }),
    setPending: (key: string, pending: any) =>
      update({ ...state, pending: { ...state.pending, [key]: pending } }),
    setCamera: (key: string, seed: any, viewId: string, camera: any) => {
      const reading = state.maps[key] ?? seed
      actions.setReading(key, {
        ...reading,
        cameras: { ...reading.cameras, [viewId]: camera },
      })
    },
  }
  const saves: any[] = []
  const host = {
    list: async () => ({
      maps: [{ id: 'map-a', title: '知识地图' }],
      diagnostics: [],
    }),
    read: async () => snapshot,
    saveLayout: async (_snapshot: unknown, layout: unknown, _signal: unknown, manual: boolean) => {
      saves.push({ layout, manual })
      snapshot = { ...snapshot, layout: layout as any, fingerprint: 'saved' }
      return snapshot
    },
    watch: () => () => {},
  }
  const tab: any = {
    visible: true,
    navigation: { revision: 0 },
    actions: { close: () => {} },
  }
  const inputActions = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
  }
  const useStore = (selector: (value: any) => any) =>
    selector(
      useSyncExternalStore(
        (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        () => state,
      ),
    )
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.querySelector('#root')!
  const root = createRoot(container)
  let accepted = false
  const drafts: any[] = []
  const insertText = (text:string, span:any) => { drafts.push({text,span}); return accepted }
  const references: any[] = []
  const insertReference = (ref:any) => { references.push(ref); return true }
  try {
    await act(async () => {
      root.render(
        createElement(AtlasPane, {
          host,
          sessionId: 's1',
          actions,
          useStore,
          useTabInfo: () => ({ tab }),
          inputActions,
          insertReference,
          insertText,
        }),
      )
    })
    assert.equal(container.querySelectorAll('.map-scene').length, 0)
    assert.ok(container.textContent?.includes('思维导图'))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.library-map button')!.click()
    })
    assert.equal(container.querySelectorAll('.map-scene').length, 1)
    assert.equal(
      container.querySelectorAll('.node:not([data-measure-node])').length,
      2,
    )
    assert.ok(container.textContent?.includes('总览'))
    const draggable = container.querySelector<HTMLElement>('[data-node="a"]')!
    const leaf = container.querySelector('[data-node="b"]')!
    const beforeX = Number.parseFloat(draggable.style.left)
    await act(async () => {
      draggable.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles:true, button:0, clientX:100, clientY:100 }))
      draggable.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles:true, clientX:140, clientY:120 }))
    })
    await act(async () => {
      draggable.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles:true, clientX:140, clientY:120 }))
      draggable.click()
    })
    assert.equal(Number.parseFloat(draggable.style.left), beforeX+40)
    assert.equal(container.querySelector('.inspector'), null)
    await act(async () => {
      leaf.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles:true, clientX:120,clientY:120 }))
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(b => b.textContent?.includes('添加到正文'))!.click()
    })
    assert.equal(JSON.parse(references.at(-1).ref).kind, 'node')
    assert.equal(JSON.parse(references.at(-1).ref).nodeId, 'b')
    await act(async () => {
      leaf.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles:true, clientX:120,clientY:120 }))
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(b => b.textContent?.includes('提问 DSH'))!.click()
    })
    assert.ok(container.querySelector('[aria-label="问题草稿"]'))
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles:true,cancelable:true }))
    })
    assert.ok(container.querySelector('[aria-label="问题草稿"]'))
    assert.ok(container.querySelector('[role="alert"]'))
    accepted = true
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles:true,cancelable:true }))
    })
    assert.equal(container.querySelector('[aria-label="问题草稿"]'), null)
    assert.equal(drafts.length, 2)
    assert.equal(drafts[1].span.draftRev, 1)
    assert.equal(saves.at(-1).manual, true)
    assert.equal(saves.at(-1).layout.views.find((v:any) => v.viewId === 'root').nodes.find((n:any) => n.nodeId === 'a').manual, true)
    await act(async () => {
      leaf.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'F10',
          shiftKey: true,
          bubbles: true,
        }),
      )
    })
    assert.ok(container.querySelector('[aria-label="节点操作"]'))
    await act(async () => {
      container
        .querySelector('[aria-label="节点操作"]')!
        .dispatchEvent(
          new dom.window.KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
          }),
        )
    })
    assert.equal(container.querySelector('[aria-label="节点操作"]'), null)
    assert.equal(dom.window.document.activeElement, leaf)
    await act(async () => {
      leaf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.ok(container.querySelector('.inspector'))
    assert.ok(container.textContent?.includes('复制笔记'))
    await act(async () => {
      container
        .querySelector('[aria-label="关闭笔记"]')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(container.querySelector('.inspector'), null)
    await act(async () => {
      container
        .querySelector('[aria-label="搜索当前地图"]')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.ok(container.querySelector('[role="dialog"]'))
    assert.equal(
      dom.window.document.activeElement?.getAttribute('aria-label'),
      '搜索标题、摘要和正文',
    )
    await act(async () => {
      container
        .querySelector('[aria-label="关闭搜索"]')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(container.querySelector('[role="dialog"]'), null)
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === '全部导图')!.click()
    })
    assert.ok(container.querySelector('.library-page'))
    assert.equal(container.querySelector('.map-scene'), null)
    // 引用导航携带 mapId 时直接进入原图，普通打开仍停留在目录。
    await act(async () => {
      tab.navigation = { revision: 1, params: { mapId: 'map-a' } }
      root.render(createElement(AtlasPane, {
        host, sessionId: 's1', actions, useStore,
        useTabInfo: () => ({ tab }), inputActions, insertReference, insertText,
      }))
    })
    assert.ok(container.querySelector('.map-scene'))
  } finally {
    await act(async () => root.unmount())
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
})
