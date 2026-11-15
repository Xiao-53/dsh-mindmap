export function restoreFocus(
  element: HTMLElement | null,
  root: HTMLElement | null,
): void {
  if (element?.isConnected && root?.contains(element)) element.focus()
  else root?.focus()
}
export function trapFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return
  const elements = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input,textarea,a[href],[tabindex="0"]',
    ),
  ].filter((el) => el.getClientRects().length)
  const first = elements[0]
  const last = elements.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
