import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'
export interface NoteSection {
  title: string
  tokens: Token[]
}
export function noteSections(markdown: string): NoteSection[] {
  const sections: NoteSection[] = []
  let current: NoteSection = { title: '', tokens: [] }
  sections.push(current)
  for (const token of Lexer.lex(markdown, { breaks: true, gfm: true })) {
    if (token.type === 'heading' && (token as Tokens.Heading).depth === 2) {
      current = { title: (token as Tokens.Heading).text, tokens: [] }
      sections.push(current)
    } else current.tokens.push(token)
  }
  // 通用思维导图按作者顺序阅读，章节名称不限于学习栏目。
  return sections.filter(s => s.tokens.some(t => t.type !== 'space'))
}
