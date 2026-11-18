import { z } from 'zod'
import { canonicalJson } from './fingerprint.ts'
import { parsePlotExpression, type Expression, type PlotRange } from './plot-expression.ts'
import { idSchema } from './validate-map.ts'

const shortText = z.string().max(120).refine(value => !!value.trim() && !/[\p{Cc}\u2028\u2029]/u.test(value))
const range = z.tuple([z.number(), z.number()]).refine(([lo, hi]) => lo < hi)
const base = { version: z.literal(1), id: idSchema, title: shortText.optional() }
const functionSchema = z.strictObject({
  ...base, kind: z.literal('function'),
  xRange: range.optional(), yRange: range.optional(),
  series: z.array(z.strictObject({ expression: z.string().min(1).max(256), label: shortText.optional() })).min(1).max(3),
})
const statisticsSchema = z.strictObject({
  ...base, kind: z.enum(['bar', 'line']),
  categories: z.array(shortText).min(1).max(100).optional(),
  series: z.array(z.strictObject({
    label: shortText, values: z.array(z.number().nullable()).min(1).max(100), unit: shortText.optional(),
  })).min(1).max(3),
})

type FunctionPlot = Omit<z.infer<typeof functionSchema>, 'xRange' | 'yRange'> & {
  xRange: PlotRange; yRange: PlotRange
}
type StatisticsPlot = Omit<z.infer<typeof statisticsSchema>, 'categories'> & { categories: string[] }
export type PlotData = FunctionPlot | StatisticsPlot

export type PlotToken = {
  type: 'notePlot'
  raw: string
  source: string
  start: number
  end: number
  id?: string
  data?: PlotData
  expressions?: Expression[]
  error?: string
}

const parseSizeLimit = 128 * 1024
export function parsePlotData(json: string): Pick<PlotToken, 'data' | 'expressions' | 'error' | 'id'> {
  if (json.length > parseSizeLimit || new TextEncoder().encode(json).length > parseSizeLimit)
    return { error: '图块 JSON 超过 128 KiB' }
  let value: unknown
  try { value = JSON.parse(json) }
  catch { return { error: '图块 JSON 无法读取' } }
  const fields = value as { version?: unknown; kind?: unknown; id?: unknown } | null
  const id = idSchema.safeParse(fields?.id).data
  if (fields?.version !== 1) return { id, error: '图块缺少版本或版本不受支持' }
  if (fields.kind === 'function') {
    const result = functionSchema.safeParse(value)
    if (!result.success) return { id, error: '函数图字段、系列或范围无效' }
    const data: FunctionPlot = { ...result.data,
      xRange: result.data.xRange ?? [-5, 5], yRange: result.data.yRange ?? [-5, 5] }
    try { return { id, data, expressions: data.series.map(item => parsePlotExpression(item.expression)) } }
    catch (error) { return { id, error: (error as Error).message } }
  }
  const result = statisticsSchema.safeParse(value)
  if (!result.success) return { id, error: '统计图字段或类型无效' }
  const { series, categories, kind } = result.data
  const size = series[0].values.length
  if ((kind === 'bar' && !categories) || (categories && categories.length !== size)
    || series.some(item => item.values.length !== size))
    return { id, error: '统计图须提供等长的数据与类目；柱状图必须提供类目' }
  return { id, data: { ...result.data, categories: categories ?? Array.from({ length: size }, (_, i) => String(i + 1)) } }
}

export const isPlot = (token: { type: string }): token is PlotToken => token.type === 'notePlot'
export const plotContent = (plot: PlotData) => canonicalJson(plot)

export function plotText(plot: PlotData): string {
  const title = plot.title ?? ({ function: '函数图', bar: '柱状图', line: '折线图' })[plot.kind]
  if (plot.kind === 'function') return [
    title, `x ∈ [${plot.xRange.join(', ')}]，y ∈ [${plot.yRange.join(', ')}]`,
    ...plot.series.map(item => (item.label ? item.label + '：' : '') + 'y = ' + item.expression),
  ].join('\n')
  return [
    title,
    ...plot.series.map(item => {
      const label = item.label + (item.unit ? `（${item.unit}）` : '')
      return label + '：' + item.values.map((value, i) => `${plot.categories[i]}=${value ?? '缺值'}`).join('、')
    }),
  ].join('\n')
}
