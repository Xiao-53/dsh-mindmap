export function workspaceComparisonKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const isUnc = /^(\\\\|\/\/)/.test(trimmed)
  const isWinDrive = /^[A-Za-z]:([/\\]|$)/.test(trimmed)
  let normalized = trimmed.replaceAll('\\', '/')
  if (isUnc) {
    normalized = '//' + normalized.slice(2).replace(/\/+/g, '/')
  } else {
    normalized = normalized.replace(/\/+/g, '/')
  }
  if (isWinDrive) {
    if (normalized.length === 2) normalized += '/'
    else if (normalized.length > 3) normalized = normalized.replace(/\/+$/, '')
    return normalized.toLowerCase()
  }
  if (isUnc) {
    const parts = normalized.slice(2).split('/')
    if (parts.length > 2) normalized = normalized.replace(/\/+$/, '')
    return normalized.toLowerCase()
  }
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '')
  return normalized
}

export function sameWorkspaceKey(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false
  return workspaceComparisonKey(a) === workspaceComparisonKey(b)
}

export function normalizeNotePathKey(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()
}
