import type { MapSnapshot } from '../shared/map-types.ts'
export class SnapshotLoader {
  generation = 0
  controller?: AbortController
  snapshot?: MapSnapshot
  cancel() {
    this.generation++
    this.controller?.abort()
  }
  async load(
    read: (signal: AbortSignal) => Promise<MapSnapshot>,
  ): Promise<
    { snapshot?: MapSnapshot; error?: string; stale?: boolean } | undefined
  > {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const generation = ++this.generation
    try {
      const candidate = await read(controller.signal)
      if (generation !== this.generation || controller.signal.aborted) return
      this.snapshot = candidate
      return { snapshot: candidate }
    } catch (e) {
      if (generation !== this.generation || controller.signal.aborted) return
      return {
        snapshot: this.snapshot,
        error: e instanceof Error ? e.message : String(e),
        stale: !!this.snapshot,
      }
    }
  }
}
