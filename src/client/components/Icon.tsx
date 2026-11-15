// SVG 元素逐项移植自 docs/knowledge_atlas_demo_v17.html。
import type { Icon as IconName } from '../../shared/map-types.ts'
const shapes = {
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5V5.5ZM4 17.5A2.5 2.5 0 0 1 6.5 15H20" /></>,
  atom: <><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="10" ry="4" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="18" cy="19" r="2" /><path d="M8 5h4a6 6 0 0 1 6 6v6M6 7v10a2 2 0 0 0 2 2h8" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  spark: <><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z" /></>,
  flask: <><path d="M9 3h6M10 3v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M7 16h10" /></>,
  check: <><path d="m5 12 5 5L20 7" /></>,
  alert: <><path d="M12 3 2 21h20L12 3ZM12 9v5m0 4h.01" /></>,
  formula: <><path d="M18 4H8a4 4 0 0 0 0 8h9a4 4 0 0 1 0 8H6M5 6l-2 2 2 2m14 4 2 2-2 2" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  idea: <><path d="M9 18h6M10 21h4M12 3a7 7 0 0 0-4 12.7c.7.5 1 1.1 1 2.3h6c0-1.2.3-1.8 1-2.3A7 7 0 0 0 12 3Z" /></>,
  arrows: <><path d="m7 7 5-5 5 5M12 2v20m-5-5 5 5 5-5" /></>,
}
export function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>
}
