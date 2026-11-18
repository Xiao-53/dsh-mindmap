import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol'

declare const __DSH_MINDMAP_PACKAGE_NAME__: string
// 打包时使用对应发行渠道的包名。直接加载 TS 源码时仍沿用原有身份。
export const ATLAS_PACKAGE_NAME = typeof __DSH_MINDMAP_PACKAGE_NAME__ === 'string'
  ? __DSH_MINDMAP_PACKAGE_NAME__
  : 'dsh-mindmap'

// 只暴露绑定 Session 的单个领域入口；payload 的对象结构仍由 Host 严格校验。
const codec = {
  mode: 'strict' as const,
  typeSymbol: `${ATLAS_PACKAGE_NAME}#string`,
  create: () => z.string(),
}
export const atlasRemote = createTypertRemoteInfo(
  {
    package: ATLAS_PACKAGE_NAME,
    methods: {
      'dshAtlas/request': {
        service: 'dshAtlas',
        invocation: { kind: 'direct' },
        parameters: [
          {
            name: 'workspaceFileScope',
            wire: 'workspaceFileScopeId',
            source: 'lookup',
            lookup: 'workspaceFileScope',
            codec: {
              ...codec,
              typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            },
            strictCodec: {
              ...codec,
              typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            },
          },
          { name: 'payload', source: 'json', codec, strictCodec: codec },
        ],
        cancellation: { parameter: 'signal' },
        result: codec,
      },
    },
  },
  z,
)
export const requestMethod = atlasRemote.methods[
  'dshAtlas/request'
] as TypertRemoteMethod<
  { workspaceFileScopeId: string; payload: string },
  string
>
