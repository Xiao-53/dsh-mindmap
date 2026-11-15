import { useEffect, useRef, useState } from 'react'
import type { ReactNode, DragEvent } from 'react'
import type { MapListing } from '../../shared/map-types.ts'
import type { MapLibrary as Library } from '../../shared/library.ts'
import { emptyLibrary } from '../../shared/library.ts'

type Form = { kind: 'folder' | 'rename-folder' | 'rename-map'; id?: string; title: string }
type Entry = { kind: 'map' | 'folder'; id: string }
const entryKey = (entry: Entry) => `${entry.kind}:${entry.id}`
const DRAG_TYPE = 'application/x-dsh-atlas-library'
export function MapLibrary({ listing, loading, error, refresh, open, rename, save, purge, cleanupCreate, trash, setTrash }: {
  listing: MapListing; loading: boolean; error: string
  refresh: () => void; open: (id: string) => void
  rename: (id: string, title: string, previousTitle: string) => Promise<void>
  save: (data: Library) => Promise<void>
  purge: (ids: string[]) => Promise<void>
  cleanupCreate: (mapId: string, operationId: string) => Promise<void>
  trash: boolean; setTrash: (trash: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [showIncomplete, setShowIncomplete] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<Form>()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<string>()
  const [menuAbove, setMenuAbove] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dropTarget, setDropTarget] = useState<string>()
  const page = useRef<HTMLDivElement>(null)
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  const data = listing.library?.data ?? emptyLibrary()
  const deleted = new Set(data.deletedMapIds ?? [])
  const purged = new Set(data.purgedMapIds ?? [])
  const purging = new Set(data.purgingMapIds ?? [])
  const activeMaps = listing.maps.filter(m => !deleted.has(m.id) && !purged.has(m.id))
  const trashMaps = [...deleted].filter(id => !purged.has(id)).map(id => listing.maps.find(m => m.id === id) ?? { id, title: data.deletedMapTitles?.[id] ?? id })
  const maps = trash ? trashMaps : activeMaps
  const needle = query.trim().toLocaleLowerCase()
  const incomplete = listing.incompleteCreates ?? []
  const visibleIncomplete = incomplete.filter(item => !needle || [item.mapId,item.operationId].some(value => value.toLocaleLowerCase().includes(needle)))
  const folderMatches = (id?: string): boolean => {
    while (id) { const folder = data.folders.find(f => f.id === id); if (!folder) break; if (folder.title.toLocaleLowerCase().includes(needle)) return true; id = folder.parentId ?? undefined }
    return false
  }
  const visibleMaps = needle ? maps.filter(map => map.title.toLocaleLowerCase().includes(needle) || folderMatches(data.mapFolders[map.id])) : maps
  const visibleFolders = new Set<string>()
  const includePath = (id?: string) => { while (id && !visibleFolders.has(id)) { visibleFolders.add(id); id = data.folders.find(f => f.id === id)?.parentId ?? undefined } }
  for (const folder of data.folders) if (!needle || folderMatches(folder.id)) includePath(folder.id)
  for (const map of visibleMaps) includePath(data.mapFolders[map.id])
  const disabled = busy || loading || !listing.library
  const available: Entry[] = [...visibleMaps.map(m => ({ kind: 'map' as const, id: m.id })), ...(!trash ? data.folders.filter(f => visibleFolders.has(f.id)).map(f => ({ kind: 'folder' as const, id: f.id })) : [])]
  const chosen = available.filter(entry => selected.has(entryKey(entry)))
  const allSelected = available.length > 0 && chosen.length === available.length
  const selection = useRef<HTMLInputElement>(null)
  useEffect(() => { setSelected(new Set()); setMenu(undefined); setForm(undefined) }, [query])
  useEffect(() => { if (selection.current) selection.current.indeterminate = chosen.length > 0 && !allSelected }, [chosen.length, allSelected])
  useEffect(() => { setSelected(new Set()); setSelecting(false); setMenu(undefined); setForm(undefined); setFailure(''); setNotice(''); setShowIncomplete(false) }, [listing.library?.workspaceKey, trash])
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.library-menu-anchor')) setMenu(undefined)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  const paths = (id: string): string => {
    const names: string[] = []; const seen = new Set<string>(); let folder = data.folders.find(f => f.id === id)
    while (folder && !seen.has(folder.id)) { seen.add(folder.id); names.unshift(folder.title); folder = data.folders.find(f => f.id === folder!.parentId) }
    return names.join(' / ') || '全部导图'
  }
  const descendant = (id: string, ancestor: string): boolean => {
    let current: string | null = id
    while (current) { if (current === ancestor) return true; current = data.folders.find(f => f.id === current)?.parentId ?? null }
    return false
  }
  const run = async (work: () => Promise<void>, success = '') => {
    if (disabled || busyRef.current) return
    busyRef.current = true; setBusy(true); setFailure(''); setNotice(''); setMenu(undefined)
    try { await work(); setSelected(new Set()); if (success) setNotice(success) }
    catch (e) { setFailure(e instanceof Error ? e.message : String(e)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const selectTrashSection = (incomplete: boolean) => {
    if (showIncomplete === incomplete) return
    setShowIncomplete(incomplete); setQuery(''); setSelected(new Set()); setSelecting(false)
    setMenu(undefined); setForm(undefined); setFailure(''); setNotice('')
  }
  const toggle = (entry: Entry) => setSelected(old => { const next = new Set(old); const key = entryKey(entry); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const checkbox = (entry: Entry, name: string) => selecting ? <input className="library-checkbox" type="checkbox" aria-label={`选择${name}`} checked={selected.has(entryKey(entry))} disabled={disabled} onChange={() => toggle(entry)} /> : null
  const begin = (next: Form) => { setForm(next); setTitle(next.title); setMenu(undefined) }
  const remove = (entries: Entry[]) => {
    const folders = new Set(entries.filter(e => e.kind === 'folder').map(e => e.id))
    const ids = entries.filter(e => e.kind === 'map').map(e => e.id)
    const parentOf = (id: string | null): string | null => {
      while (id && folders.has(id)) id = data.folders.find(f => f.id === id)?.parentId ?? null
      return id
    }
    const mapFolders = { ...data.mapFolders }
    for (const id of Object.keys(mapFolders)) { const parent = parentOf(mapFolders[id]); if (parent) mapFolders[id] = parent; else delete mapFolders[id] }
    const deletedMapTitles = { ...data.deletedMapTitles }
    for (const id of ids) deletedMapTitles[id] = listing.maps.find(m => m.id === id)?.title ?? id
    return run(() => save({ ...data, folders: data.folders.filter(f => !folders.has(f.id)).map(f => ({ ...f, parentId: parentOf(f.parentId) })), mapFolders,
      deletedMapIds: [...new Set([...deleted, ...ids])], deletedMapTitles }))
  }
  const restore = (input: string[]) => { const ids = input.filter(id => !purging.has(id)); return run(() => save({ ...data, deletedMapIds: [...deleted].filter(id => !ids.includes(id)),
    deletedMapTitles: Object.fromEntries(Object.entries(data.deletedMapTitles ?? {}).filter(([id]) => !ids.includes(id))) }), `已还原 ${ids.length} 张导图`) }
  const permanentlyRemove = (ids: string[]) => run(() => purge(ids))
  const startDrag = (event: DragEvent, entry: Entry) => {
    if (disabled || trash || (event.target instanceof Element && event.target.closest('input, .library-menu-anchor, .library-inline-form'))) { event.preventDefault(); return }
    const entries = selected.has(entryKey(entry)) ? chosen : [entry]
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(entries)); event.dataTransfer.effectAllowed = 'move'; setMenu(undefined)
  }
  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => { if (!disabled && !trash && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget(folder) } },
    onDragLeave: (e: DragEvent) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDropTarget(undefined) },
    onDrop: (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDropTarget(undefined)
      if (disabled || trash) return
      let entries: Entry[]
      try { entries = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); if (!Array.isArray(entries) || !entries.length || entries.some(entry => !available.some(valid => valid.id === entry.id && valid.kind === entry.kind))) return } catch { return }
      const folders = entries.filter(entry => entry.kind === 'folder').map(entry => entry.id)
      if (folder && folders.some(id => descendant(folder, id))) { setFailure('不能将文件夹移入自身或其子文件夹。'); return }
      void run(async () => {
        const mapFolders = { ...data.mapFolders }
        for (const entry of entries) if (entry.kind === 'map' && !folders.some(id => data.mapFolders[entry.id] && descendant(data.mapFolders[entry.id], id))) { if (folder) mapFolders[entry.id] = folder; else delete mapFolders[entry.id] }
        await save({ ...data, mapFolders, folders: data.folders.map(f => folders.includes(f.id) && !folders.some(id => id !== f.id && descendant(f.id, id)) ? { ...f, parentId: folder || null } : f) })
        setCollapsed(old => { const next = new Set(old); next.delete(folder); return next })
      }, '已移动所选项目')
    },
  })
  const submit = () => run(async () => {
    if (!form || !title.trim()) return
    if (form.kind === 'folder') await save({ ...data, folders: [...data.folders, { id: crypto.randomUUID(), title: title.trim(), parentId: null }] })
    if (form.kind === 'rename-folder') await save({ ...data, folders: data.folders.map(f => f.id === form.id ? { ...f, title: title.trim() } : f) })
    if (form.kind === 'rename-map') await rename(form.id!, title.trim(), form.title)
    setForm(undefined)
  })
  const nameForm = (inline = false) => <form className={inline ? 'library-inline-form' : 'library-form'} onSubmit={e => { e.preventDefault(); void submit() }}>
    <input autoFocus aria-label={form?.kind === 'folder' ? '新文件夹名称' : '新名称'} placeholder="文件夹名称" required maxLength={120} disabled={busy} value={title} onChange={e => setTitle(e.target.value)} />
    <button className="library-text-button" disabled={busy || !title.trim()}>保存</button><button type="button" className="library-text-button" disabled={busy} onClick={() => { setForm(undefined); menuTrigger.current?.focus() }}>取消</button>
  </form>
  const more = (entry: Entry, name: string) => {
    const key = entryKey(entry)
    return <div className="library-menu-anchor"><button className="library-more" aria-label={`管理${name}`} aria-haspopup="menu" aria-expanded={menu === key} disabled={disabled} onClick={e => { menuTrigger.current = e.currentTarget; const bounds = page.current?.querySelector('.library-scroll')?.getBoundingClientRect(); setMenuAbove(!!bounds && bounds.bottom - e.currentTarget.getBoundingClientRect().bottom < 100); setMenu(menu === key ? undefined : key) }}>···</button>
      {menu === key && <div className={`library-entry-menu ${menuAbove ? 'above' : ''}`} role="menu" onKeyDown={e => {
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (index + 1) % items.length : e.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
        if (next >= 0) { e.preventDefault(); items[next]?.focus() }
      }}>{trash ? <>{!purging.has(entry.id) && <button autoFocus role="menuitem" onClick={() => { void restore([entry.id]) }}>还原</button>}<button autoFocus={purging.has(entry.id)} role="menuitem" className="danger" onClick={() => { void permanentlyRemove([entry.id]) }}>{purging.has(entry.id) ? '继续删除' : '永久删除'}</button></> : <><button autoFocus role="menuitem" onClick={() => begin({ kind: entry.kind === 'map' ? 'rename-map' : 'rename-folder', id: entry.id, title: name })}>重命名</button><button role="menuitem" className="danger" title={entry.kind === 'folder' ? '删除文件夹，内容移至上一级' : '移入回收站'} onClick={() => { void remove([entry]) }}>删除</button></>}</div>}
    </div>
  }
  const mapRow = (map: MapListing['maps'][number]) => {
    const entry: Entry = { kind: 'map', id: map.id }
    return <li key={entryKey(entry)} className={`library-entry library-map ${selected.has(entryKey(entry)) ? 'is-selected' : ''}`} draggable={!trash && !disabled} onDragStart={e => startDrag(e, entry)} onDragEnd={() => setDropTarget(undefined)}>
      <div className="library-entry-line">{checkbox(entry, map.title)}
        {form?.kind === 'rename-map' && form.id === map.id ? nameForm(true) : trash ? <div className="library-row library-trash-row" title={data.mapFolders[map.id] ? paths(data.mapFolders[map.id]) : '全部导图'}><LibraryGlyph file /><span>{map.title}{purging.has(map.id) && <small>删除未完成 · 可重试</small>}</span></div> : <button className="library-row" disabled={busy} onClick={() => open(map.id)} title={map.title}><LibraryGlyph file /><span>{map.title}</span></button>}
        {more(entry, map.title)}
      </div>
    </li>
  }
  const branch = (parentId: string | null): ReactNode => <ul className="library-tree">
    {data.folders.filter(f => f.parentId === parentId && visibleFolders.has(f.id)).map(f => {
      const shut = !needle && collapsed.has(f.id); const entry: Entry = { kind: 'folder', id: f.id }
      return <li key={entryKey(entry)} className={`library-entry ${dropTarget === f.id ? 'library-drop-target' : ''}`}>
        <div className={`library-entry-line ${selected.has(entryKey(entry)) ? 'is-selected' : ''}`} {...dropProps(f.id)} draggable={!disabled} onDragStart={e => startDrag(e, entry)} onDragEnd={() => setDropTarget(undefined)}>
          {checkbox(entry, `文件夹${f.title}`)}
          {form?.kind === 'rename-folder' && form.id === f.id ? nameForm(true) : <button className="library-row library-folder" aria-expanded={!shut} onClick={() => setCollapsed(old => { const next = new Set(old); if (shut) next.delete(f.id); else next.add(f.id); return next })}><svg className={`library-chevron ${shut ? 'shut' : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg><LibraryGlyph /><span>{f.title}</span><small>{activeMaps.filter(m => data.mapFolders[m.id] === f.id).length}</small></button>}
          {more(entry, f.title)}
        </div>
        {!shut && <div className="library-children">{branch(f.id)}</div>}
      </li>
    })}
    {visibleMaps.filter(m => (data.mapFolders[m.id] ?? null) === parentId).map(mapRow)}
    {!needle && parentId && !data.folders.some(f => f.parentId === parentId) && !activeMaps.some(m => data.mapFolders[m.id] === parentId) && <li className="library-folder-empty" {...dropProps(parentId)}>将导图或文件夹拖到这里</li>}
  </ul>
  return <div ref={page} className="dsh-atlas library-page" aria-busy={loading || busy} onKeyDown={e => { if (e.key === 'Escape') { if (menu || form) { setMenu(undefined); menuTrigger.current?.focus(); if (!busy) setForm(undefined) } else if (query) { e.preventDefault(); setQuery('') } } }}>
    <header className="library-header"><div className="library-brand"><LibraryGlyph /><h1>思维导图</h1></div><button className="library-trash-toggle" title={trash ? '返回全部导图' : `回收站（${trashMaps.length}）`} aria-label={trash ? '返回全部导图' : '回收站'} aria-pressed={trash} disabled={busy} onClick={() => setTrash(!trash)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></button></header>
    <div className="library-scroll">
      <label className="library-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input type="search" aria-label={trash && showIncomplete ? '搜索未完成创建' : trash ? '搜索回收站' : '搜索导图或文件夹'} placeholder={trash && showIncomplete ? '搜索未完成创建…' : trash ? '搜索回收站…' : '搜索导图或文件夹…'} value={query} disabled={busy} onChange={e => setQuery(e.target.value)} /></label>
      {(error || failure) && <div className="status-region" role="alert">{error || failure}<br /><button className="library-text-button" disabled={busy} onClick={refresh}>重新载入</button></div>}
      <div className="library-section" {...dropProps('')}><div className="library-section-label">
        {trash ? <button type="button" className="library-scope library-section-tab" aria-pressed={!showIncomplete} disabled={busy} onClick={() => selectTrashSection(false)}>回收站<small>{trashMaps.length}</small></button> : <span className="library-scope">全部导图<small>{activeMaps.length}</small></span>}
        {trash && <button type="button" className="library-subentry" aria-pressed={showIncomplete} disabled={busy} onClick={() => selectTrashSection(true)}>未完成创建<small>{incomplete.length}</small></button>}
      </div>
        <div className="library-section-tools">
          {!trash && <button className="library-text-button" disabled={disabled} onClick={() => begin({ kind: 'folder', title: '' })}>＋ 文件夹</button>}
          {!(trash && showIncomplete) && !!available.length && <button className="library-text-button" aria-pressed={selecting} disabled={busy} onClick={() => { setSelecting(!selecting); setSelected(new Set()); setMenu(undefined) }}>{selecting ? '完成' : '选择'}</button>}
          {trash && !showIncomplete && !!trashMaps.length && <div className="library-menu-anchor"><button className="library-more" aria-label="回收站选项" aria-haspopup="menu" aria-expanded={menu === 'trash-all'} disabled={disabled} onClick={e => { menuTrigger.current = e.currentTarget; setMenuAbove(false); setMenu(menu === 'trash-all' ? undefined : 'trash-all') }}>···</button>
            {menu === 'trash-all' && <div className="library-entry-menu" role="menu"><button autoFocus role="menuitem" disabled={!trashMaps.some(m => !purging.has(m.id))} onClick={() => { void restore(trashMaps.map(m => m.id)) }}>全部还原</button><button role="menuitem" className="danger" onClick={() => { void permanentlyRemove(trashMaps.map(m => m.id)) }}>清空回收站</button></div>}
          </div>}
        </div>
      </div>
      {form?.kind === 'folder' && nameForm()}
      {selecting && !!available.length && <div className="library-batch"><label><input ref={selection} className="library-checkbox" type="checkbox" aria-label="全选全部项目" disabled={disabled} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(available.map(entryKey)))} /><span>{chosen.length ? `已选 ${chosen.length} 项` : '全选'}</span></label>
        <div className="library-batch-tools">{trash && <button className="library-text-button" disabled={disabled || !chosen.some(e => !purging.has(e.id))} onClick={() => { void restore(chosen.map(e => e.id)) }}>还原</button>}<button className="library-text-button danger" disabled={disabled || !chosen.length} onClick={() => { if (trash) void permanentlyRemove(chosen.map(e => e.id)); else void remove(chosen) }}>{trash ? '永久删除' : '删除'}</button></div>
      </div>}
      {notice && <p className="library-notice" role="status">{notice}</p>}
      {loading ? <p role="status">正在读取目录…</p> : trash && showIncomplete ? <ul className="library-tree">{visibleIncomplete.map(item => <li key={item.mapId} className="library-incomplete-row"><LibraryGlyph file /><div><span>{item.operationId}</span><small>{item.state === 'cleanup_pending' ? '清理未完成，可继续清理' : item.state === 'failed' ? '创建失败，尚未生成地图' : '尚未生成地图'} · {item.mapId}</small></div><button type="button" className="library-text-button danger" disabled={disabled} title="清理记录并作废原创建请求" aria-label={`清理未完成创建 ${item.operationId}`} onClick={() => { void run(() => cleanupCreate(item.mapId,item.operationId)) }}>{item.state === 'cleanup_pending' ? '继续清理' : '清理'}</button></li>)}{!visibleIncomplete.length && <li className="library-folder-empty">{needle ? '没有匹配的创建记录' : '没有未完成创建'}</li>}</ul> : trash ? <ul className="library-tree">{visibleMaps.map(mapRow)}{!visibleMaps.length && <li className="library-folder-empty">{needle ? '没有匹配的导图' : '回收站为空'}</li>}</ul> : <div className={dropTarget === '' ? 'library-drop-target' : ''} {...dropProps('')}>{branch(null)}{needle && !visibleMaps.length && !visibleFolders.size && <p className="library-folder-empty">没有匹配的导图或文件夹</p>}</div>}
      {!loading && !needle && !trash && !activeMaps.length && !data.folders.length && <section className="library-empty"><LibraryGlyph /><h2>暂无思维导图</h2><p>在输入框选择 /mindmap skill，填写创建需求后手动发送，导图会显示在这里。</p></section>}
      {!!listing.diagnostics.length && <details className="library-diagnostics"><summary>有 {listing.diagnostics.length} 项未能载入</summary>{listing.diagnostics.map(d => <p key={d.path}>{d.path}：{d.message}</p>)}</details>}
    </div>
  </div>
}
function LibraryGlyph({ file = false }: { file?: boolean }) {
  return <svg className="library-glyph" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{file ? <path d="M14 3H6v18h12V7zM14 3v5h4M9 12h6M9 16h5" /> : <path d="M3 7V5h6l2 3h10v12H3V7z" />}</svg>
}
