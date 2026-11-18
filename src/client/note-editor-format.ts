import { syntaxTree } from '@codemirror/language'
import { countColumn, StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export const setNoteComposition = StateEffect.define<boolean>()
const focusEffect = StateEffect.define<boolean>()
const presentation = StateField.define({
  create: () => ({ focused: false, composing: false }),
  update(previous, transaction) {
    let { focused, composing } = previous
    for (const effect of transaction.effects) {
      if (effect.is(focusEffect)) focused = effect.value
      if (effect.is(setNoteComposition)) composing = effect.value
    }
    return focused === previous.focused && composing === previous.composing ? previous : { focused, composing }
  },
})

export const notePresentation = [presentation, EditorView.focusChangeEffect.of((_state, focused) => focusEffect.of(focused))]
export const noteComposing = (state: EditorState) => state.field(presentation).composing
export const notePresentationChanged = (before: EditorState, after: EditorState) => before.field(presentation) !== after.field(presentation)

export function noteRangeActive(state: EditorState, from: number, to: number) {
  if (!state.field(presentation).focused) return false
  return state.selection.ranges.some(range => range.empty
    ? range.head >= from && range.head <= to
    : range.from < to && range.to > from)
}

class Bullet extends WidgetType {
  toDOM(view: EditorView) {
    const marker = view.dom.ownerDocument.createElement('span')
    marker.className = 'note-cm-marker'
    marker.textContent = '•'
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }
}

const hide = Decoration.replace({})
const bullet = Decoration.replace({ widget: new Bullet() })
const marker = Decoration.mark({ class: 'note-cm-marker' })
const bold = Decoration.mark({ tagName: 'strong' })
const italic = Decoration.mark({ tagName: 'em' })
const strike = Decoration.mark({ tagName: 'del' })
const code = Decoration.mark({ tagName: 'code' })
const link = Decoration.mark({ class: 'note-rich-link' })
const inertGap = Decoration.line({ class: 'note-cm-gap' })
const heading = Array.from({ length: 6 }, (_, i) => Decoration.line({ class: 'note-cm-h' + (i + 1) }))
const quoteLine = Decoration.line({ class: 'note-cm-quote' })
const codeLine = Decoration.line({ class: 'note-cm-code' })

export function noteFormatExtension(opaqueRanges: (state: EditorState) => readonly { from: number; to: number }[]) {
  function build(view: EditorView) {
    const { state } = view
    const tree = syntaxTree(state)
    const opaque = opaqueRanges(state)
    const ranges: Range<Decoration>[] = []
    const seen = new Set<string>()
    const add = (style: Decoration, from: number, to = from) => ranges.push(style.range(from, to))
    const covered = (from: number, to: number) => opaque.some(range => range.from < to && from < range.to)
    for (const visible of view.visibleRanges) {
      for (let n = state.doc.lineAt(visible.from).number; n <= state.doc.lineAt(visible.to).number; n++) {
        const line = state.doc.line(n)
        if (!line.text && !noteRangeActive(state, line.from, line.to)) add(inertGap, line.from)
      }
      tree.iterate({ from: visible.from, to: visible.to, enter(node) {
        const { name } = node.type
        const { from, to } = node
        if (opaque.some(range => range.from <= from && range.to >= to)) return false
        const key = name + ':' + from + ':' + to
        // 同一语法父节点可能横跨图片等预览切开的多个可见范围。去重时仍须访问后面的子节点。
        if (seen.has(key)) return
        seen.add(key)
        const active = noteRangeActive(state, from, to)
        const title = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)
        if (title) {
          const line = state.doc.lineAt(from)
          add(heading[Number(title[1]) - 1], line.from)
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name !== 'HeaderMark') continue
            const markLine = state.doc.lineAt(child.from)
            if (markLine.number !== line.number) {
              if (!active) add(inertGap, markLine.from)
              if (!active) add(hide, child.from, child.to)
              continue
            }
            const end = child.from === from
              ? child.to + (/^[ \t]+/.exec(state.sliceDoc(child.to, line.to))?.[0].length ?? 0)
              : child.to
            add(active ? marker : hide, child.from, end)
          }
        } else if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough') {
          add(name === 'StrongEmphasis' ? bold : name === 'Strikethrough' ? strike : italic, from, to)
          for (let child = node.node.firstChild; child; child = child.nextSibling)
            if (child.name === 'EmphasisMark' || child.name === 'StrikethroughMark') {
              if (!covered(child.from, child.to)) add(active ? marker : hide, child.from, child.to)
            }
        } else if (name === 'ListMark' || name === 'QuoteMark') {
          if (covered(from, to)) return false
          const line = state.doc.lineAt(from)
          const rowActive = noteRangeActive(state, line.from, line.to)
          if (name === 'QuoteMark') {
            add(quoteLine, line.from)
            add(rowActive ? marker : hide, from, to + Number(state.sliceDoc(to, to + 1) === ' '))
          } else {
            const space = /^[ \t]*/.exec(state.sliceDoc(to, line.to))?.[0].length ?? 0
            const indent = countColumn(state.sliceDoc(line.from, to + space), state.tabSize)
            add(Decoration.line({ class: 'note-cm-list', attributes: { style: '--note-list-indent:' + indent + 'ch' } }), line.from)
            add(!rowActive && /^[-+*]$/.test(state.sliceDoc(from, to)) ? bullet : marker, from, to)
          }
        } else if (name === 'InlineCode') {
          add(code, from, to)
          if (!active) for (let child = node.node.firstChild; child; child = child.nextSibling)
            if (child.name === 'CodeMark') add(hide, child.from, child.to)
          return false
        } else if (name === 'FencedCode' || name === 'CodeBlock') {
          for (let i = state.doc.lineAt(from).number; i <= state.doc.lineAt(to).number; i++) {
            const line = state.doc.line(i)
            if (line.to >= visible.from && line.from <= visible.to) add(codeLine, line.from)
          }
          return false
        } else if (name === 'Link' && !covered(from, to)) {
          add(link, from, to)
          if (!active) {
            const close = node.node.getChildren('LinkMark').find(mark => state.sliceDoc(mark.from, mark.to) === ']')
            if (close && state.doc.lineAt(close.from).number === state.doc.lineAt(to).number && state.sliceDoc(from, from + 1) === '[') {
              add(hide, from, from + 1)
              add(hide, close.from, to)
            }
          }
        }
      } })
    }
    return Decoration.set(ranges, true)
  }

  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(change: ViewUpdate) {
      if (noteComposing(change.state)) this.decorations = this.decorations.map(change.changes)
      else if (change.docChanged || change.selectionSet || change.viewportChanged ||
        notePresentationChanged(change.startState, change.state) || syntaxTree(change.startState) !== syntaxTree(change.state))
        this.decorations = build(change.view)
    }
  }, { decorations: plugin => plugin.decorations })
}
