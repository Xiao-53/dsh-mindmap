export type PlotRange = readonly [number, number]
export type PlotPoint = readonly [number, number]

const functions = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt,
  abs: Math.abs, exp: Math.exp, ln: Math.log,
}
type MathName = keyof typeof functions
type Operator = '+' | '-' | '*' | '/' | '^'
export type Expression =
  | { kind: 'number'; value: number }
  | { kind: 'x' | 'pi' | 'e' }
  | { kind: 'negative'; operand: Expression }
  | { kind: 'call'; name: MathName; operand: Expression }
  | { kind: 'binary'; op: Operator; left: Expression; right: Expression }

export function parsePlotExpression(source: string): Expression {
  if (!source.trim() || source.length > 256) throw new Error('函数式须为 1–256 字符')
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]+|[^\s]/g) ?? []
  let cursor = 0
  const take = (token: string) => {
    if (tokens[cursor] !== token) return false
    cursor++
    return true
  }
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 }

  function expression(min: number, depth: number): Expression {
    if (depth > 32) throw new Error('函数式嵌套超过 32 层')
    const token = tokens[cursor++]
    let left: Expression
    if (token === '(') {
      left = expression(0, depth + 1)
      if (!take(')')) throw new Error('函数式缺少右括号')
    } else if (token === '+' || token === '-') {
      const operand = expression(3, depth + 1)
      left = token === '-' ? { kind: 'negative', operand } : operand
    } else if (token === 'x' || token === 'pi' || token === 'e') {
      left = { kind: token }
    } else if (token && Object.hasOwn(functions, token)) {
      if (!take('(')) throw new Error('函数参数须放在括号内')
      const operand = expression(0, depth + 1)
      if (!take(')')) throw new Error('函数式缺少右括号')
      left = { kind: 'call', name: token as MathName, operand }
    } else if (token && /^[.\d]/.test(token) && Number.isFinite(Number(token))) {
      left = { kind: 'number', value: Number(token) }
    } else {
      throw new Error('函数式含无效数值或不支持的语法')
    }
    while (tokens[cursor] !== undefined) {
      const op = tokens[cursor] as Operator
      const level = Object.hasOwn(precedence, op) ? precedence[op] : 0
      if (!level || level < min) break
      cursor++
      left = { kind: 'binary', op, left, right: expression(level + (op === '^' ? 0 : 1), depth + 1) }
    }
    return left
  }

  const tree = expression(0, 0)
  if (cursor !== tokens.length) throw new Error('函数式含多余内容，乘法须使用 *')
  return tree
}

function evalAt(tree: Expression, x: number): number {
  switch (tree.kind) {
    case 'number': return tree.value
    case 'x': return x
    case 'pi': return Math.PI
    case 'e': return Math.E
    case 'negative': return -evalAt(tree.operand, x)
    case 'call': {
      const value = evalAt(tree.operand, x)
      if (!Number.isFinite(value) || (tree.name === 'tan' && Math.abs(Math.cos(value)) <= Number.EPSILON)) return NaN
      return functions[tree.name](value)
    }
    case 'binary': {
      const left = evalAt(tree.left, x)
      const right = evalAt(tree.right, x)
      if (!Number.isFinite(left) || !Number.isFinite(right)) return NaN
      switch (tree.op) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/': return left / right
        case '^': return left ** right
      }
    }
  }
}

const bounds = (values: number[]): PlotRange | undefined =>
  values.every(Number.isFinite) ? [Math.min(...values), Math.max(...values)] : undefined
const hasPhase = (lo: number, hi: number, offset: number, period: number) =>
  Math.ceil((lo - offset) / period) <= Math.floor((hi - offset) / period)

// null means the whole interval is outside the domain. Undefined requires subdivision.
function interval(tree: Expression, range: PlotRange): PlotRange | null | undefined {
  switch (tree.kind) {
    case 'number': return [tree.value, tree.value]
    case 'x': return range
    case 'pi': return [Math.PI, Math.PI]
    case 'e': return [Math.E, Math.E]
    case 'negative': {
      const input = interval(tree.operand, range)
      return input && [-input[1], -input[0]]
    }
    case 'call': {
      const input = interval(tree.operand, range)
      if (!input) return input
      const [lo, hi] = input
      const [a, b] = input.map(functions[tree.name])
      switch (tree.name) {
        case 'tan': return hasPhase(lo, hi, Math.PI / 2, Math.PI) ? undefined : bounds([a, b])
        case 'sin': case 'cos': {
          const peak = tree.name === 'sin' ? Math.PI / 2 : 0
          return bounds([a, b, hasPhase(lo, hi, peak, 2 * Math.PI) ? 1 : a,
            hasPhase(lo, hi, peak + Math.PI, 2 * Math.PI) ? -1 : b])
        }
        case 'abs': return bounds([a, b, lo <= 0 && hi >= 0 ? 0 : a])
        case 'sqrt': return hi < 0 ? null : bounds([a, b])
        case 'ln': return hi <= 0 ? null : bounds([a, b])
        case 'exp': return bounds([a, b])
      }
    }
    case 'binary': {
      const left = interval(tree.left, range)
      const right = interval(tree.right, range)
      if (left === null || right === null) return null
      if (!left || !right) return
      const [a, b] = left, [c, d] = right
      switch (tree.op) {
        case '+': return bounds([a + c, b + d])
        case '-': return bounds([a - d, b - c])
        case '*': return bounds([a * c, a * d, b * c, b * d])
        case '/':
          if (c === 0 && d === 0) return null
          return c <= 0 && d >= 0 ? undefined : bounds([a / c, a / d, b / c, b / d])
        case '^': {
          if (c === d && Number.isInteger(c)) {
            if (a <= 0 && b >= 0 && c < 0) return
            return bounds([a ** c, b ** c, a <= 0 && b >= 0 ? 0 ** c : a ** c])
          }
          if (b < 0 && c === d) return null
          if (a < 0 || (a === 0 && c <= 0)) return
          return bounds([a ** c, a ** d, b ** c, b ** d])
        }
      }
    }
  }
}

export function plotInterpolate(a: number, b: number, t: number): number {
  const span = b - a
  if (!Number.isFinite(span)) return a * (1 - t) + b * t
  return t <= 0.5 ? a + span * t : b - span * (1 - t)
}

export function plotFraction(value: number, a: number, b: number): number {
  return Number.isFinite(b - a)
    ? (value - a) / (b - a)
    : (value / 2 - a / 2) / (b / 2 - a / 2)
}

function clip(left: PlotPoint, right: PlotPoint, [lo, hi]: PlotRange): [PlotPoint, PlotPoint] | undefined {
  if ((left[1] < lo && right[1] < lo) || (left[1] > hi && right[1] > hi)) return
  const inside = (point: PlotPoint): PlotPoint => {
    const y = Math.min(hi, Math.max(lo, point[1]))
    return y === point[1] ? point : [
      plotInterpolate(left[0], right[0], plotFraction(y, left[1], right[1])), y,
    ]
  }
  return [inside(left), inside(right)]
}

export function samplePlot(tree: Expression, xRange: PlotRange, yRange: PlotRange): PlotPoint[][] {
  const segments: PlotPoint[][] = []
  const isolated = new Set<number>()
  let segment: PlotPoint[] | undefined
  const same = (a: PlotPoint, b: PlotPoint) => a[0] === b[0] && a[1] === b[1]
  const keepPoint = (point: PlotPoint) => {
    if (point[1] >= yRange[0] && point[1] <= yRange[1] && !isolated.has(point[0])) {
      isolated.add(point[0])
      segments.push([point])
    }
  }
  function sample(left: PlotPoint, right: PlotPoint, depth: number) {
    const domain = interval(tree, [left[0], right[0]])
    if (domain === null || (domain && (domain[1] < yRange[0] || domain[0] > yRange[1]))) {
      segment = undefined
      return
    }
    const x = plotInterpolate(left[0], right[0], 0.5)
    const middle: PlotPoint = [x, evalAt(tree, x)]
    const finite = Number.isFinite(left[1]) && Number.isFinite(middle[1]) && Number.isFinite(right[1])
    const bend = finite && Math.abs(
      plotFraction(middle[1], ...yRange) -
      plotInterpolate(plotFraction(left[1], ...yRange), plotFraction(right[1], ...yRange), 0.5),
    ) > 0.008
    if ((!domain || !finite || bend) && depth < 5 && x > left[0] && x < right[0]) {
      sample(left, middle, depth + 1)
      sample(middle, right, depth + 1)
      return
    }
    const line = domain && finite ? clip(left, right, yRange) : undefined
    if (!line) {
      segment = undefined
      if (!domain) {
        keepPoint(left)
        keepPoint(middle)
        keepPoint(right)
      }
      return
    }
    if (!segment || !same(segment[segment.length - 1], line[0])) {
      segment = [line[0]]
      segments.push(segment)
    }
    if (!same(line[0], line[1])) segment.push(line[1])
  }

  const count = 160
  let left: PlotPoint = [xRange[0], evalAt(tree, xRange[0])]
  for (let i = 1; i <= count; i++) {
    const x = plotInterpolate(...xRange, i / count)
    const right: PlotPoint = [x, evalAt(tree, x)]
    sample(left, right, 0)
    left = right
  }
  return segments
}

export function plotExpressionTex(tree: Expression): string {
  const wrap = (tex: string) => '\\left(' + tex + '\\right)'
  switch (tree.kind) {
    case 'number': return String(tree.value).replace(/e\+?(-?\d+)$/, '\\times 10^{$1}')
    case 'x': case 'e': return tree.kind
    case 'pi': return '\\pi'
    case 'negative': return '-' + wrap(plotExpressionTex(tree.operand))
    case 'call': {
      const operand = plotExpressionTex(tree.operand)
      if (tree.name === 'sqrt') return '\\sqrt{' + operand + '}'
      if (tree.name === 'abs') return '\\left|' + operand + '\\right|'
      return '\\' + tree.name + wrap(operand)
    }
    case 'binary': {
      const left = plotExpressionTex(tree.left), right = plotExpressionTex(tree.right)
      if (tree.op === '/') return '\\frac{' + left + '}{' + right + '}'
      if (tree.op === '^') return wrap(left) + '^{' + right + '}'
      return wrap(left + (tree.op === '*' ? '\\cdot ' : tree.op) + right)
    }
  }
}
