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
const bootDom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
const bootOriginals = new Map<string, PropertyDescriptor | undefined>()
for (const [k, v] of [['window', bootDom.window], ['document', bootDom.window.document], ['Element', bootDom.window.Element], ['HTMLElement', bootDom.window.HTMLElement], ['Node', bootDom.window.Node]] as const) {
  bootOriginals.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
  Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
}
const { AtlasPane, ReadingPane, RenderNote, Icon, createOfflineHtml, NeighborPills, computeViewNeighbors, classifyEdgeFocus, MapScene } = await import(
  pathToFileURL(resolve('node_modules/.cache/dsh-mindmap/ui.mjs')).href
)
await import('react-dom/client')
for (const [k, orig] of bootOriginals) {
  if (orig) Object.defineProperty(globalThis, k, orig)
  else Reflect.deleteProperty(globalThis, k)
}
bootDom.window.close()
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
  const layoutBeforeExport = JSON.stringify(snapshot.layout)
  const exported = createOfflineHtml(snapshot, snapshot.layout, 'root', 'void 0;')
  assert.equal(JSON.stringify(snapshot.layout), layoutBeforeExport)
  const document = new JSDOM(exported).window.document
  assert.equal(document.querySelectorAll('script').length, 2)
  assert.equal(document.title, snapshot.map.title)
  const embedded = JSON.parse(document.querySelector('#atlas-data')!.textContent!)
  assert.equal(embedded.notes.quantum, snapshot.notes.quantum)
  assert.deepEqual(embedded.layout, snapshot.layout)
  assert.ok(!exported.includes('test-only'))
  assert.ok(!exported.includes('src="http'))
})

test('笔记原始 HTML、脚本、事件及危险协议不执行，合法本地图片经白名单显示，非图片本地链接显示只读提示', () => {
  const markup = renderToStaticMarkup(
    createElement(RenderNote, {
      nodeId: 'a',
      resources: { 'a:../assets/a.png': 'data:image/png;base64,aGVsbG8=' },
      markdown:
        '## 核心理解\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[坏链接](javascript:alert%281%29)\n\n[本地文档](../assets/doc.pdf)\n\n![本地图](../assets/a.png)\n\nE = mc²',
    }),
  )
  assert.ok(!markup.includes('<script'))
  assert.ok(!markup.includes('<img src="x"'))
  assert.ok(!markup.includes('href="javascript:'))
  assert.ok(!markup.includes('data:application/pdf'))
  assert.ok(markup.includes('<span>本地文档</span>（仅支持网络链接与本地图片）'))
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
    commitEdit: async (req: any) => {
      if (req.edit.kind === 'layout') {
        const nextLayout = {
          schemaVersion: 2 as const,
          mapId: snapshot.map.id,
          views: [...(snapshot.layout?.views ?? []).filter((v: any) => v.viewId !== req.edit.viewId), req.edit.layout],
        }
        saves.push({ layout: nextLayout, manual: req.edit.layout.nodes.some((n: any) => n.manual) })
        snapshot = { ...snapshot, layout: nextLayout, fingerprint: 'saved-' + saves.length }
      }
      return { snapshot, committedFingerprint: snapshot.fingerprint, noChange: false }
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
    assert.ok(container.querySelector('.edges.edges-base'))
    assert.ok(container.querySelector('.edge-labels'))
    assert.equal(container.querySelector('.edges-focus'), null)
    const edgePaths = Array.from(container.querySelectorAll<SVGPathElement>('.edges path.edge'))
    assert.ok(edgePaths.length >= 2)
    for (const edgePath of edgePaths) {
      const d = edgePath.getAttribute('d') ?? ''
      assert.match(d, /^M-?\d.* [CL]/)
      assert.ok(!d.includes('NaN'))
    }
    assert.equal(container.querySelectorAll('.edges path.edge-arrow').length, edgePaths.length)
    const draggable = container.querySelector<HTMLElement>('[data-node="a"]')!
    const leaf = container.querySelector('[data-node="b"]')!
    const parseX = (el: HTMLElement) => Number.parseFloat(/translate\((-?\d+(?:\.\d+)?)px/.exec(el.style.transform)?.[1] ?? el.style.left)
    const beforeX = parseX(draggable)
    await act(async () => {
      draggable.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles:true, button:0, clientX:100, clientY:100 }))
      draggable.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles:true, clientX:140, clientY:120 }))
    })
    await act(async () => {
      draggable.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles:true, clientX:140, clientY:120 }))
      draggable.click()
      draggable.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
    })
    assert.equal(parseX(draggable), beforeX+40)
    assert.equal(container.querySelector('.inspector'), null)
    assert.notEqual((Object.values(state.maps)[0] as any)?.viewId, 'child')
    await act(async () => {
      leaf.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles:true, clientX:120,clientY:120 }))
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(b => b.textContent?.includes('添加到正文'))!.click()
    })
    assert.equal(JSON.parse(references.at(-1).ref).kind, 'node')
    assert.equal(JSON.parse(references.at(-1).ref).nodeId, 'b')
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
      container.querySelector('.reading-pane')!.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
      )
    })
    assert.equal(parseX(draggable), beforeX)
    await act(async () => {
      container.querySelector('.reading-pane')!.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Z', metaKey: true, shiftKey: true, bubbles: true }),
      )
    })
    assert.equal(parseX(draggable), beforeX + 40)
    await act(async () => {
      leaf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.ok(container.querySelector('.inspector'))
    assert.ok(container.textContent?.includes('复制内容'))
    assert.ok(container.querySelector('[data-neighbor-node="a"][data-neighbor-role="prerequisites"]'))
    assert.ok(container.querySelector('[data-relation="ab"][data-focus="in"]'))
    assert.ok(container.querySelector('[data-relation="ba"][data-focus="supplement"]'))
    assert.ok(container.querySelector('.edges-focus [data-relation="ab"][data-focus="in"]'))
    assert.equal(container.querySelector('.edges-base [data-focus="in"]'), null)
    const readingState = () => Object.values(state.maps)[0] as any
    const cameraBeforeNeighbor = { ...readingState().cameras.root }
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-neighbor-node="a"]')!.click() })
    assert.equal(readingState().viewId, 'root') // a 有 childViewId，胶囊不下钻。
    assert.equal(readingState().selectedNodeId, 'a')
    assert.notDeepEqual(readingState().cameras.root, cameraBeforeNeighbor)
    assert.ok(container.querySelector('[data-neighbor-node="b"][data-neighbor-role="dependents"]'))
    assert.ok(container.querySelector('[data-relation="ab"][data-focus="out"]'))
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-neighbor-node="b"]')!.click() })
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="关闭笔记"]')!.click() })
    assert.equal(container.querySelector('.inspector'), null)
    assert.equal(readingState().selectedNodeId, 'b')
    assert.equal(readingState().detailHidden, true)
    assert.ok(container.querySelector('[data-relation="ab"][data-focus="in"]'))
    await act(async () => { leaf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.ok(container.querySelector('.inspector'))
    const escape = () => container.querySelector('.reading-pane')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await act(async () => { escape() })
    assert.equal(readingState().detailHidden, true)
    await act(async () => { escape() })
    assert.equal(readingState().selectedNodeId, undefined)
    assert.equal(container.querySelector('[data-focus]'), null)
    assert.equal(container.querySelector('.edges-focus'), null)
    await act(async () => { leaf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    const canvas = container.querySelector('.map-wrap')!
    await act(async () => {
      canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      canvas.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 35, clientY: 10 }))
      canvas.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 35, clientY: 10 }))
    })
    assert.equal(readingState().selectedNodeId, 'b')
    await act(async () => {
      canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      canvas.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }))
    })
    assert.equal(readingState().selectedNodeId, undefined)
    await act(async () => { leaf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })

    await act(async () => {
      draggable.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
      draggable.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 115, clientY: 100 }))
    })
    await act(async () => {
      tab.navigation = { revision: 2, params: { mapId: 'map-b', autoOpen: true } }
      root.render(createElement(AtlasPane, {
        host, sessionId: 's1', actions, useStore,
        useTabInfo: () => ({ tab }), inputActions, insertReference,
      }))
    })
    assert.ok(container.textContent?.includes('AI 已完成导图更新'))
    assert.ok(container.querySelector('.inspector'))
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('.status-region button')).find(b => b.textContent === '忽略')?.click()
      draggable.dispatchEvent(new dom.window.MouseEvent('pointercancel', { bubbles: true }))
    })
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
        useTabInfo: () => ({ tab }), inputActions, insertReference,
      }))
    })
    assert.ok(container.querySelector('.map-scene'))
    const subgraphNode = container.querySelector<HTMLElement>('[data-node="a"]')!
    const leafNode = container.querySelector<HTMLElement>('[data-node="b"]')!
    const currentReading = () => Object.values(state.maps)[0] as any
    await act(async () => { leafNode.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.ok(container.querySelector('.inspector'))
    await act(async () => { subgraphNode.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.equal(currentReading().viewId, 'root')
    assert.equal(currentReading().selectedNodeId, 'a')
    assert.equal(currentReading().detailHidden, true)
    assert.equal(container.querySelector('.inspector'), null)
    assert.ok(container.querySelector('.edges-focus [data-relation="ab"][data-focus="out"]'))
    await act(async () => {
      container.querySelector('.reading-pane')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(currentReading().selectedNodeId, undefined)
    await act(async () => {
      subgraphNode.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    assert.equal(currentReading().viewId, 'root')
    assert.equal(currentReading().selectedNodeId, 'a')
    assert.equal(currentReading().detailHidden, true)
    await act(async () => {
      subgraphNode.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
    })
    assert.equal(currentReading().viewId, 'child')
  } finally {
    await act(async () => root.unmount())
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
})

test('管理页支持直接拖到目标导图下方、展开文件夹内不冒泡回根目录、文件夹排序不嵌套且搜索禁用拖拽', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of [
    ['window', dom.window],
    ['document', dom.window.document],
    ['Element', dom.window.Element],
    ['HTMLElement', dom.window.HTMLElement],
    ['Node', dom.window.Node],
    ['IS_REACT_ACT_ENVIRONMENT', true],
  ] as const) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const savedLibraries: any[] = []
  let libraryState = {
    version: 'v1',
    workspaceKey: 'ws-1',
    data: {
      schemaVersion: 1 as const,
      folders: [
        { id: 'f1', title: '文件夹一', parentId: null },
        { id: 'f2', title: '文件夹二', parentId: null },
      ],
      mapFolders: { m1: 'f1', m2: 'f1' },
    },
  }
  const host = {
    list: async () => ({
      maps: [
        { id: 'a', title: '根目录 A' },
        { id: 'b', title: '根目录 B' },
        { id: 'm1', title: '内部 1' },
        { id: 'm2', title: '内部 2' },
      ],
      diagnostics: [],
      library: libraryState,
    }),
    saveLibrary: async (data: any) => {
      savedLibraries.push(data)
      libraryState = { ...libraryState, version: `v${savedLibraries.length + 1}`, data }
      return libraryState
    },
    watch: () => () => {},
  }
  const listeners = new Set<() => void>()
  const state = { selectedMapId: undefined, maps: {}, pending: {} }
  const useStore = (selector: (v: any) => any) =>
    selector(useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => state))
  const tab: any = { visible: true, navigation: { revision: 0 }, actions: { close: () => {} } }
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.querySelector('#root')!
  const root = createRoot(container)
  const makeTransfer = (payload?: string) => {
    const store = new Map<string, string>(payload ? [['application/x-dsh-atlas-library', payload]] : [])
    return {
      types: ['application/x-dsh-atlas-library'],
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: (k: string, v: string) => { store.set(k, v) },
      getData: (k: string) => store.get(k) ?? '',
    }
  }
  try {
    await act(async () => {
      root.render(createElement(AtlasPane, {
        host, sessionId: 's1',
        actions: { selectMap: () => {}, setReading: () => {}, setPending: () => {}, setCamera: () => {} },
        useStore, useTabInfo: () => ({ tab }),
        inputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) },
        insertReference: () => true,
      }))
    })
    const rowByTitle = (title: string) =>
      Array.from(container.querySelectorAll<HTMLLIElement>('.library-map')).find(li => li.textContent?.includes(title))!
    const folderLineByTitle = (title: string) =>
      Array.from(container.querySelectorAll<HTMLElement>('.library-entry-line')).find(el => el.textContent?.includes(title))!

    // 1. 直接把根目录 A 拖到已展开文件夹 f1 内 内部 1 下方（getBoundingClientRect 默认高 0 时默认落在下方）
    const dragA = rowByTitle('根目录 A')
    const targetM1 = rowByTitle('内部 1')
    const dt1 = makeTransfer()
    await act(async () => {
      const start = new dom.window.Event('dragstart', { bubbles: true, cancelable: true })
      Object.defineProperty(start, 'dataTransfer', { value: dt1 })
      dragA.dispatchEvent(start)
      const over = new dom.window.Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(over, 'dataTransfer', { value: dt1 })
      targetM1.dispatchEvent(over)
    })
    assert.ok(targetM1.querySelector('.library-entry-line')?.classList.contains('is-drop-after'))
    await act(async () => {
      const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dt1 })
      targetM1.dispatchEvent(drop)
    })
    assert.equal(savedLibraries.at(-1).mapFolders.a, 'f1')
    assert.deepEqual(savedLibraries.at(-1).folderMapOrders.f1, ['m1', 'a', 'm2'])

    // 2. 拖动文件夹 f2 到 f1 位置只调整顺序，不发生嵌套
    const lineF2 = folderLineByTitle('文件夹二')
    const lineF1 = folderLineByTitle('文件夹一')
    const dt2 = makeTransfer()
    await act(async () => {
      const start = new dom.window.Event('dragstart', { bubbles: true, cancelable: true })
      Object.defineProperty(start, 'dataTransfer', { value: dt2 })
      lineF2.dispatchEvent(start)
      const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dt2 })
      lineF1.dispatchEvent(drop)
    })
    assert.deepEqual(savedLibraries.at(-1).folders.map((f: any) => f.id), ['f2', 'f1'])
    assert.ok(savedLibraries.at(-1).folders.every((f: any) => f.parentId === null))

    // 3. 搜索期间禁用拖拽
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, '内部')
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(rowByTitle('内部 1').getAttribute('draggable'), 'false')
  } finally {
    await act(async () => root.unmount())
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
})


test('关系胶囊按当前视图过滤、稳定去重，未选中恢复默认连线', async () => {
  const { sampleMap } = await import('../support/maps.ts')
  const map = sampleMap(), view = map.views[0]
  map.nodes.push({ id: 'outside', title: '外部', summary: '', category: 'blue', icon: 'book' })
  map.relations.push(
    { id: 'duplicate', fromNodeId: 'a', toNodeId: 'b', type: 'dependency' },
    { id: 'hidden', fromNodeId: 'b', toNodeId: 'a', type: 'dependency' },
    { id: 'external', fromNodeId: 'outside', toNodeId: 'b', type: 'dependency' },
  )
  view.relationIds.push('duplicate', 'external')
  const neighbors = computeViewNeighbors(map, view, 'b')
  assert.deepEqual(neighbors.prerequisites.map((n: any) => n.nodeId), ['a'])
  assert.deepEqual(neighbors.dependents, [])
  assert.deepEqual(neighbors.supplements.map((n: any) => n.nodeId), ['a'])
  const markup = renderToStaticMarkup(createElement(NeighborPills, { map, view, nodeId: 'b', onSelect: () => {} }))
  assert.ok(markup.includes('前置依赖'))
  assert.ok(!markup.includes('外部'))
  assert.equal(classifyEdgeFocus(map.relations[0]), 'default')
  assert.equal(classifyEdgeFocus(map.relations[0], 'outside'), 'dimmed')
  assert.equal(classifyEdgeFocus(map.relations[0], 'a'), 'out')
  assert.equal(classifyEdgeFocus(map.relations[0], 'b'), 'in')
  assert.equal(classifyEdgeFocus(map.relations[1], 'a'), 'supplement')
})

test('MapScene 四层渲染：常态仅底层连线与胶囊，单击选中才挂载 edges-focus 且胶囊联动', async () => {
  const { snapshot } = await loadPrototype()
  const view = snapshot.map.views.find(v => v.id === 'root')!
  const layout = snapshot.layout!.views.find(v => v.viewId === 'root')!
  const first = snapshot.map.relations.find(r => r.id === view.relationIds[0])!
  const map = { ...snapshot.map, relations: snapshot.map.relations.map(r => (r.id === first.id ? { ...r, label: '因果关系' } : r)) }
  const render = (selected?: string) =>
    new JSDOM(renderToStaticMarkup(createElement(MapScene, { map, view, layout, heights: {}, selected, onOpen() {}, onNote() {} }))).window.document
  const idle = render()
  assert.ok(idle.querySelector('.edges.edges-base'))
  assert.equal(idle.querySelector('.edges-focus'), null)
  const pill = idle.querySelector(`.edge-labels .edge-pill[data-relation="${first.id}"]`)!
  assert.equal(pill.getAttribute('title'), '因果关系')
  assert.ok(!pill.classList.contains('is-focused') && !pill.classList.contains('is-dimmed'))
  assert.match(pill.getAttribute('style') ?? '', /left:\s*-?\d/)
  assert.equal(idle.querySelectorAll('.edge-labels text, .edges text').length, 0)
  assert.ok(idle.querySelector('.atlas-ports'))

  const picked = render(first.fromNodeId)
  assert.ok(picked.querySelector('.edges.edges-focus'))
  assert.ok(picked.querySelector(`.edges-focus [data-relation="${first.id}"]`))
  assert.equal(picked.querySelector(`.edges-base [data-relation="${first.id}"]`), null)
  assert.ok(picked.querySelector(`.edge-pill[data-relation="${first.id}"].is-focused`))
})

test('014 MapScene 单击选中挂载高亮光晕、悬停不提层，水平短边胶囊输出内联 maxWidth', async () => {
  const { emptyMap } = await import('../support/maps.ts')
  const map = emptyMap()
  map.nodes = [
    { id: 'a', title: '节点甲', summary: '', category: 'blue', icon: 'book' },
    { id: 'b', title: '节点乙', summary: '', category: 'sage', icon: 'idea' },
  ]
  map.views[0].groups = [{ id: 'g1', title: '组一', number: '1', category: 'blue' }]
  map.views[0].occurrences = [
    { nodeId: 'a', groupId: 'g1' },
    { nodeId: 'b', groupId: 'g1' },
  ]
  map.relations = [{ id: 'ab', fromNodeId: 'a', toNodeId: 'b', type: 'dependency', label: '前置因果依赖关系' }]
  map.views[0].relationIds = ['ab']
  const viewLayout = {
    viewId: 'root',
    mode: 'vertical' as const,
    nodes: [
      { nodeId: 'a', x: 66, y: 110, width: 236, manual: false },
      { nodeId: 'b', x: 393, y: 110, width: 236, manual: false }, // 精确 91px 水平净空
    ],
    groups: [{ groupId: 'g1', x: 42, y: 48, width: 611, height: 178 }],
  }

  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of [
    ['window', dom.window],
    ['document', dom.window.document],
    ['Element', dom.window.Element],
    ['HTMLElement', dom.window.HTMLElement],
    ['Node', dom.window.Node],
    ['IS_REACT_ACT_ENVIRONMENT', true],
  ] as const) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.querySelector('#root')!
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(createElement(MapScene, { map, view: map.views[0], layout: viewLayout, heights: {}, onOpen() {}, onNote() {} }))
    })
    // 常态及悬停绝不挂载 edges-focus 或 edge-focus-halo
    assert.equal(container.querySelector('.edges-focus'), null)
    assert.equal(container.querySelector('.edge-focus-halo'), null)
    const nodeA = container.querySelector<HTMLElement>('[data-node="a"]')!
    await act(async () => {
      nodeA.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }))
      nodeA.dispatchEvent(new dom.window.MouseEvent('mouseenter', { bubbles: false }))
    })
    assert.equal(container.querySelector('.edges-focus'), null)
    assert.equal(container.querySelector('.edge-focus-halo'), null)

    // 91px 水平短边胶囊渲染自适应内联 maxWidth（91 - 18 = 73px）
    const pill = container.querySelector<HTMLElement>('.edge-labels .edge-pill[data-relation="ab"]')!
    assert.equal(pill.style.maxWidth, '73px')

    // 单击选中节点后，.edges-focus 挂载 .edge-focus-halo 且位于主连线路径之前
    await act(async () => {
      root.render(
        createElement(MapScene, { map, view: map.views[0], layout: viewLayout, heights: {}, selected: 'a', onOpen() {}, onNote() {} }),
      )
    })
    const focusGroup = container.querySelector('.edges-focus [data-relation="ab"]')!
    const paths = Array.from(focusGroup.querySelectorAll('path'))
    assert.ok(paths[0]?.classList.contains('edge-focus-halo'))
    assert.ok(paths[1]?.classList.contains('edge'))
  } finally {
    await act(async () => root.unmount())
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
})

test('014 非离线工具栏“整理未锁定节点”保留手动拖动节点、整理未锁定节点且可撤销；离线模式不显示入口', async () => {
  const { emptyMap } = await import('../support/maps.ts')
  const map = emptyMap()
  map.id = 'tidy-map'
  map.nodes = [
    { id: 'a', title: '甲', summary: '', category: 'blue', icon: 'book' },
    { id: 'b', title: '乙', summary: '', category: 'sage', icon: 'idea' },
    { id: 'c', title: '丙', summary: '', category: 'gold', icon: 'spark' },
  ]
  map.views[0].groups = [{ id: 'g1', title: '组一', number: '1', category: 'blue' }]
  map.views[0].occurrences = [
    { nodeId: 'a', groupId: 'g1' },
    { nodeId: 'b', groupId: 'g1' },
    { nodeId: 'c', groupId: 'g1' },
  ]
  map.relations = [
    { id: 'ab', fromNodeId: 'a', toNodeId: 'b', type: 'dependency' },
    { id: 'bc', fromNodeId: 'b', toNodeId: 'c', type: 'dependency' },
  ]
  map.views[0].relationIds = ['ab', 'bc']
  // 初始布局故意把 b 和 c 对调，便于观察“整理未锁定节点”整理效果与一步撤销
  let snapshot: any = {
    map,
    layout: {
      schemaVersion: 2 as const,
      mapId: map.id,
      views: [
        {
          viewId: 'root',
          mode: 'vertical' as const,
          nodes: [
            { nodeId: 'a', x: 66, y: 110, width: 236, manual: false },
            { nodeId: 'b', x: 720, y: 110, width: 236, manual: false },
            { nodeId: 'c', x: 393, y: 110, width: 236, manual: false },
          ],
          groups: [{ groupId: 'g1', x: 42, y: 48, width: 938, height: 178 }],
        },
      ],
    },
    notes: { a: '', b: '', c: '' },
    resources: {},
    files: [],
    fingerprint: 'tidy-v1',
    workspaceKey: 'ws-tidy',
  }

  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://atlas.test' })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const name of ['window', 'document', 'Element', 'HTMLElement', 'Node', 'NodeFilter', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  }
  class Observer {
    callback: (entries: unknown[]) => void
    constructor(callback: (entries: unknown[]) => void) {
      this.callback = callback
    }
    observe() {
      this.callback([{ contentRect: { width: 1200, height: 800 } }])
    }
    disconnect() {}
  }
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    ResizeObserver: Observer,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true }) })
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
    value: () => ({ width: 236, height: 100, x: 0, y: 0, top: 0, left: 0, bottom: 100, right: 236 }),
  })
  for (const name of ['setPointerCapture', 'releasePointerCapture']) {
    Object.defineProperty(dom.window.HTMLElement.prototype, name, { value: () => {} })
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'hasPointerCapture', { value: () => true })

  let state: any = { maps: {}, pending: {}, selectedMapId: 'tidy-map' }
  const listeners = new Set<() => void>()
  const update = (next: any) => {
    state = next
    listeners.forEach(fn => fn())
  }
  const actions = {
    selectMap: (id: string) => update({ ...state, selectedMapId: id }),
    setReading: (key: string, reading: any) => update({ ...state, maps: { ...state.maps, [key]: reading } }),
    setPending: (key: string, pending: any) => update({ ...state, pending: { ...state.pending, [key]: pending } }),
    setCamera: (key: string, seed: any, viewId: string, camera: any) => {
      const reading = state.maps[key] ?? seed
      actions.setReading(key, { ...reading, cameras: { ...reading.cameras, [viewId]: camera } })
    },
  }
  let saveSeq = 0
  const host = {
    list: async () => ({ maps: [{ id: 'tidy-map', title: '局部整理图' }], diagnostics: [] }),
    read: async () => snapshot,
    commitEdit: async (req: any) => {
      if (req.edit.kind === 'layout') {
        const nextLayout = {
          schemaVersion: 2 as const,
          mapId: snapshot.map.id,
          views: [...(snapshot.layout?.views ?? []).filter((v: any) => v.viewId !== req.edit.viewId), req.edit.layout],
        }
        saveSeq++
        snapshot = { ...snapshot, layout: nextLayout, fingerprint: `tidy-saved-${saveSeq}` }
      }
      return { snapshot, committedFingerprint: snapshot.fingerprint, noChange: false }
    },
    watch: () => () => {},
  }
  const tab: any = { visible: true, navigation: { revision: 1, params: { mapId: 'tidy-map' } }, actions: { close: () => {} } }
  const useStore = (selector: (v: any) => any) =>
    selector(useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => state))
  const parsePos = (el: HTMLElement) => {
    const m = /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(el.style.transform)
    return m
      ? { x: Number.parseFloat(m[1]), y: Number.parseFloat(m[2]) }
      : { x: Number.parseFloat(el.style.left), y: Number.parseFloat(el.style.top) }
  }

  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.querySelector('#root')!
  const root = createRoot(container)
  try {
    // 1) 非离线模式：渲染按钮、拖动锁定节点 a、点击整理、再撤销恢复
    await act(async () => {
      root.render(
        createElement(AtlasPane, {
          host,
          sessionId: 's-tidy',
          actions,
          useStore,
          useTabInfo: () => ({ tab }),
          inputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) },
          insertReference: () => true,
        }),
      )
    })
    const tidyBtn = container.querySelector<HTMLButtonElement>('[aria-label="整理未锁定节点"]')
    assert.ok(tidyBtn, '非离线模式应渲染整理未锁定节点按钮')

    const nodeA = container.querySelector<HTMLElement>('[data-node="a"]')!
    const nodeB = container.querySelector<HTMLElement>('[data-node="b"]')!
    const startA = parsePos(nodeA)
    const startB = parsePos(nodeB)
    await act(async () => {
      nodeA.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
      nodeA.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 140, clientY: 120 }))
    })
    await act(async () => {
      nodeA.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 140, clientY: 120 }))
    })
    const pinnedA = parsePos(container.querySelector<HTMLElement>('[data-node="a"]')!)
    assert.equal(pinnedA.x, startA.x + 40)
    assert.equal(pinnedA.y, startA.y + 20)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="整理未锁定节点"]')!.click()
    })
    const afterTidyA = parsePos(container.querySelector<HTMLElement>('[data-node="a"]')!)
    const afterTidyB = parsePos(container.querySelector<HTMLElement>('[data-node="b"]')!)
    assert.deepEqual(afterTidyA, pinnedA, '手动锁定节点坐标应保持零漂移')
    assert.notDeepEqual(afterTidyB, startB, '未锁定节点应被重新整理到更优位置')

    await act(async () => {
      container.querySelector('.reading-pane')!.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
      )
    })
    assert.deepEqual(parsePos(container.querySelector<HTMLElement>('[data-node="b"]')!), startB, '撤销应一步恢复整理前布局')

    // 2) 离线只读模式：不渲染“整理未锁定节点”入口
    await act(async () => {
      root.render(
        createElement(ReadingPane, {
          offline: true,
          host: { list: host.list, read: host.read },
          sessionId: 's-offline',
          actions,
          useStore,
          useTabInfo: () => ({ tab }),
          onLibrary: () => {},
        }),
      )
    })
    assert.ok(container.querySelector('.map-scene'))
    assert.equal(container.querySelector('[aria-label="整理未锁定节点"]'), null, '离线模式不得渲染整理未锁定节点按钮')
  } finally {
    await act(async () => root.unmount())
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
})
