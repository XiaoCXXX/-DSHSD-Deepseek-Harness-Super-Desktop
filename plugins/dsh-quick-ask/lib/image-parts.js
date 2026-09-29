// 图片 part 的校验与规范化。
//
// 单独成文件的原因：这是**服务端边界**上的输入校验，规则必须能脱离
// DSH 运行时单独测（tools/verify-screenshot.js 直接 import 它）。
// 放在 index.js 里就只能起一个真 DSH 才能覆盖，成本高得多。
//
// 客户端（lib/screenshot.js）已经缩过一次图，但这里仍然要自己判：
// 客户端版本可能不一致，也可能有别的调用方，服务端不能信任何一边。

/** DSH 接受的图片类型；其余一律丢掉，别让一个坏 part 把整条 prompt 弄失败。 */
export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** 单张图的体积上限（对应 DSH 的 ImageAttachmentLimits.maxImageBytes 默认值）。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** 一条消息里最多几张图。 */
export const MAX_IMAGES = 4

/**
 * 把请求体里的图片整成 DSH 的 image part。
 * 不合格的**丢弃**而不是抛错：一张坏图不该让整个提问失败。
 *
 * @param {unknown} raw
 * @returns {Array<{type:'image',mediaType:string,data:string,name?:string}>}
 */
export function imageParts(raw) {
  if (!Array.isArray(raw)) return []
  const parts = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const mediaType = String(item.mediaType || '')
    const data = typeof item.data === 'string' ? item.data : ''
    if (!IMAGE_TYPES.has(mediaType) || !data) continue
    // base64 长度 ×3/4 ≈ 原始字节数，不必真解码就能判断
    if (data.length * 0.75 > MAX_IMAGE_BYTES) continue
    const part = { type: 'image', mediaType, data }
    if (item.name) part.name = String(item.name)
    parts.push(part)
    if (parts.length >= MAX_IMAGES) break
  }
  return parts
}
