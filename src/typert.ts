import { ATLAS_PACKAGE_NAME, atlasRemote } from './shared/rpc.ts'
// 与官方 /typert 导出的 Host contribution 相同，供宿主装配严格描述。
export const TYPERT = {
  package: ATLAS_PACKAGE_NAME,
  face: 'host',
  schemas: [],
  get invocations() {
    return atlasRemote.descriptors
  },
  model: { services: [], events: [], objects: [] },
}
