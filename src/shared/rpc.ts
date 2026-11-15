import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol'

// 只暴露绑定 Session 的单个领域入口；payload 的对象结构仍由 Host 严格校验。
const codec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-mindmap#string',
  create: () => z.string(),
}
export const atlasRemote = createTypertRemoteInfo(
  {
    package: 'dsh-mindmap',
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
