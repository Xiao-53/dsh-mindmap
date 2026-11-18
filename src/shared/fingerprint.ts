import type { ReadFile } from './map-types.ts'
export async function digest(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : Uint8Array.from(input)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
export async function fingerprint(files: ReadFile[]): Promise<string> {
  return digest(
    JSON.stringify(
      files
        .filter((f) => !/(^|\/)(exports|\.transactions)(\/|$)/.test(f.path))
        .toSorted((a, b) => a.path.localeCompare(b.path)),
    ),
  )
}

// 跨 UI/Host 的请求摘要不依赖对象字段的插入顺序。
export function canonicalJson(input: unknown): string {
  return JSON.stringify(input, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : value) ?? 'null'
}
