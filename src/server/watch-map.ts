import type { MapSnapshot } from '../shared/map-types.ts'
// 宿主文件监听在目录层生效；只观察去重后的目录路径，最多 16 条流。
export function watchPaths(snapshot: MapSnapshot): string[] {
  const base = `dsh-knowledge-maps/${snapshot.map.id}`
  const dirs = new Set<string>([base, `${base}/.transactions`])
  for (const file of snapshot.files) {
    let dir = file.path.slice(0, file.path.lastIndexOf('/'))
    while (dir.startsWith(base) && dir.length > base.length) {
      dirs.add(dir)
      dir = dir.slice(0, dir.lastIndexOf('/'))
    }
  }
  return [...dirs].slice(0, 16)
}
