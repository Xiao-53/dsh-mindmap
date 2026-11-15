import { heightKey } from '../shared/layout.ts'
import type { Heights } from '../shared/layout.ts'
export function measureNodes(container: HTMLElement): Heights {
  const heights: Heights = {}
  container
    .querySelectorAll<HTMLElement>('[data-measure-node]')
    .forEach((el) => {
      if (el.dataset.view && el.dataset.measureNode)
        heights[heightKey(el.dataset.view, el.dataset.measureNode)] = Math.ceil(
          el.getBoundingClientRect().height,
        )
    })
  return heights
}
