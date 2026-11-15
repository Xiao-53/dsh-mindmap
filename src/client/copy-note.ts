import type { Token, Tokens } from 'marked'
import { noteSections } from '../shared/note-sections.ts'
export function tokenText(token: Token): string {
  const t = token as Token & {
    tokens?: Token[]
    text?: string
    items?: Tokens.ListItem[]
  }
  if (t.type === 'br') return '\n'
  if (t.type === 'list')
    return (t.items ?? []).map((item) => tokenText(item)).join('\n')
  if (t.type === 'table') {
    const table = t as Tokens.Table
    return [table.header, ...table.rows]
      .map((row) => row.map((cell) => cell.text).join(' | '))
      .join('\n')
  }
  return t.tokens ? t.tokens.map(tokenText).join('') : (t.text ?? t.raw ?? '')
}
export function readableNote(
  title: string,
  summary: string,
  markdown: string,
): string {
  return [
    title,
    summary,
    ...noteSections(markdown).flatMap((section) => [
      section.title,
      ...section.tokens.map(tokenText),
    ]),
  ]
    .filter(Boolean)
    .join('\n\n')
}
export async function copyNote(
  text: string,
  write: (text: string) => Promise<void> = (value) =>
    navigator.clipboard.writeText(value),
): Promise<{ ok: boolean; message: string }> {
  try {
    await write(text)
    return { ok: true, message: '笔记已复制' }
  } catch (e) {
    return {
      ok: false,
      message: `复制失败，仍可选择原文：${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
