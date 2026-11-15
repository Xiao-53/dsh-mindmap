import type { MapSnapshot } from '../shared/map-types.ts'
// 每个文件及其直接父目录均单独观察；不假设目录订阅递归。
export function watchPaths(snapshot: MapSnapshot): string[] {
  const base = `dsh-knowledge-maps/${snapshot.map.id}`
  const paths = new Set([
    base,
    `${base}/map.json`,
    `${base}/layout.json`,
    `${base}/.transactions/active.json`,
  ])
  for (const file of snapshot.files) {
    paths.add(file.path)
    let dir = file.path.slice(0, file.path.lastIndexOf('/'))
    while (dir.startsWith(base) && dir.length > base.length) {
      paths.add(dir)
      dir = dir.slice(0, dir.lastIndexOf('/'))
    }
  }
  return [...paths]
}
