import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react'

export type AtlasTheme = 'light' | 'dark'

export interface AtlasThemeState {
  theme: AtlasTheme
  dark: boolean
  toggle: () => void
}

const STORAGE_KEY = 'dsh-mindmap-offline-theme'
const listeners = new Set<() => void>()
let override: AtlasTheme | undefined

function emit() {
  for (const listener of listeners) listener()
}

function readHostDark(): boolean {
  return typeof document !== 'undefined' && !!document.body?.hasAttribute('data-ds-dark-theme')
}

function readSystemDark(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
}

function readOfflineOverride(): AtlasTheme | undefined {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    return saved === 'light' || saved === 'dark' ? saved : undefined
  } catch {
    return undefined
  }
}

export function resolveAtlasTheme(offline = false): AtlasTheme {
  if (offline) {
    const saved = override ?? readOfflineOverride()
    if (saved) return saved
    return readSystemDark() ? 'dark' : 'light'
  }
  if (override) return override
  return readHostDark() ? 'dark' : 'light'
}

export function toggleAtlasTheme(offline = false): AtlasTheme {
  const current = resolveAtlasTheme(offline)
  const next: AtlasTheme = current === 'dark' ? 'light' : 'dark'
  override = next
  if (offline) {
    try {
      localStorage?.setItem(STORAGE_KEY, next)
    } catch {
      // 忽略本地文件或受限上下文中的存储异常。
    }
  }
  emit()
  return next
}

let observerCount = 0
let disconnectObservers: (() => void) | undefined

function retainObservers() {
  observerCount++
  if (observerCount > 1) return () => releaseObservers()

  const cleanups: (() => void)[] = []
  if (typeof document !== 'undefined' && document.body && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      // 宿主切换全局主题时清除临时手动覆盖，恢复与宿主同步。
      override = undefined
      emit()
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    cleanups.push(() => observer.disconnect())
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => emit()
    query.addEventListener?.('change', onChange)
    cleanups.push(() => query.removeEventListener?.('change', onChange))
  }
  disconnectObservers = () => {
    for (const stop of cleanups) stop()
    disconnectObservers = undefined
  }
  return () => releaseObservers()
}

function releaseObservers() {
  observerCount = Math.max(0, observerCount - 1)
  if (observerCount === 0) disconnectObservers?.()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const release = retainObservers()
  return () => {
    listeners.delete(listener)
    release()
  }
}

const AtlasThemeContext = createContext<AtlasThemeState | undefined>(undefined)

export function AtlasThemeProvider({ value, children }: { value: AtlasThemeState; children: ReactNode }) {
  return createElement(AtlasThemeContext.Provider, { value }, children)
}

export function useAtlasTheme(offline = false): AtlasThemeState {
  const theme = useSyncExternalStore(
    subscribe,
    () => resolveAtlasTheme(offline),
    () => 'light' as AtlasTheme,
  )
  useEffect(() => {
    if (!offline || typeof document === 'undefined') return
    document.documentElement.style.colorScheme = theme
    document.documentElement.style.background = theme === 'dark' ? '#181715' : '#f6f2e9'
  }, [offline, theme])
  return {
    theme,
    dark: theme === 'dark',
    toggle: () => toggleAtlasTheme(offline),
  }
}

export function useAtlasThemeContext(): AtlasThemeState {
  const ctx = useContext(AtlasThemeContext)
  const fallback = useAtlasTheme(false)
  return ctx ?? fallback
}
