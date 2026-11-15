// 工具栏图标沿用 v17 的 SVG；宿主新增的返回目录、刷新、关闭使用相同笔触。
export function ToolIcon({ name }: { name: 'search' | 'export' | 'note' | 'back' | 'library' | 'refresh' | 'close' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'search' && <><circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4 4"/></>}
    {name === 'export' && <path d="M12 3v11m-4-4 4 4 4-4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>}
    {name === 'note' && <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>}
    {name === 'back' && <path d="m15 18-6-6 6-6"/>}
    {name === 'library' && <><path d="M3 7V5h6l2 3h10v12H3V7z"/></>}
    {name === 'refresh' && <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5"/>}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6"/>}
  </svg>
}
