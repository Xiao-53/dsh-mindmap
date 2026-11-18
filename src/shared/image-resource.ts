import { z } from 'zod'
import { digest } from './fingerprint.ts'
export const IMAGE_LIMIT = 8 * 1024 * 1024
export const imageAssetSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('image'),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  encoding: z.literal('base64'), byteLength: z.number().int().positive().max(IMAGE_LIMIT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.string().max(Math.ceil(IMAGE_LIMIT / 3) * 4),
})
export type ImageAsset = z.infer<typeof imageAssetSchema>
export async function validateImage(input: unknown): Promise<ImageAsset> {
  const asset = imageAssetSchema.parse(input)
  let bytes: Uint8Array
  try {
    if(asset.data.length%4 || /[^A-Za-z0-9+/=]/.test(asset.data))throw new Error('base64')
    const binary=atob(asset.data)
    if(btoa(binary)!==asset.data)throw new Error('base64')
    bytes=Uint8Array.from(binary,c=>c.charCodeAt(0))
  }catch { throw Object.assign(new Error('图片编码无效'),{code:'invalid_image'}) }
  const signature = asset.mimeType === 'image/png'
    ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
    : asset.mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP'
  if (!signature || bytes.length !== asset.byteLength || await digest(bytes) !== asset.sha256) throw Object.assign(new Error('图片格式、长度或摘要不匹配'),{code:'invalid_image'})
  return asset
}
export const imageUrl = (a: ImageAsset) => `data:${a.mimeType};base64,${a.data}`
