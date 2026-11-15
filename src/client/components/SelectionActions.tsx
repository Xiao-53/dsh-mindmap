import type { SelectionSnapshot } from '../selection.ts'
export function SelectionActions({
  selection,
  insert,
  retry,
}: {
  selection?: SelectionSnapshot
  insert: () => void
  retry?: () => void
}) {
  return (
    <>
      <button
        className="btn primary"
        disabled={!selection}
        onMouseDown={(e) => e.preventDefault()}
        onClick={insert}
        title="选中笔记文字后加入所属会话的输入框"
      >
        加入选文
      </button>
      {retry && (
        <button className="btn" onClick={retry}>
          重试上次引用
        </button>
      )}
    </>
  )
}
