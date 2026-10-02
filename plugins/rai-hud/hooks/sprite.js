// The mascot: a hooded hacker in profile at a monitor, 28x18 pixels drawn as
// 28x9 terminal cells with half blocks (top pixel = foreground, bottom =
// background). The monitor does most of the acting: code scrolls, a magnifier
// sweeps, a prompt blinks, the screen flashes red. Pure functions only.

export const WIDTH = 28
export const HEIGHT = 18
export const ROWS = HEIGHT / 2

// The terminal's default color, used for transparent pixels
const NONE = 0x01000000

const PALETTE = {
  '.': NONE,
  H: 0x2b2f3a, // hood
  h: 0x434a5c, // hood edge
  F: 0x0b0d12, // face shadow
  E: 0x00ff9c, // eye
  e: 0x0f6b48, // dim eye
  R: 0xff3355, // red
  r: 0x4a0d18, // red screen
  W: 0xffe8ec, // alert white
  K: 0x4a5265, // gloves
  k: 0x343b4a, // keyboard
  M: 0x252b38, // monitor bezel
  m: 0x323a4b, // bezel highlight
  S: 0x04130d, // screen
  O: 0x07080b, // screen off
  G: 0x00ff9c, // bright green
  g: 0x0d6b47, // dim green
  c: 0x14a86f, // mid green
  d: 0x2f3542, // desk edge
  D: 0x171b23, // desk
  u: 0xa8714c, // mug
  U: 0x6e4a33, // mug shade
  w: 0x9aa3b5, // steam
  // Hood colors unlocked by level: body / edge
  N: 0x1d3a2c,
  n: 0x2f6b4f, // green
  P: 0x33204a,
  p: 0x5b3a86, // purple
  X: 0x4a1620,
  x: 0x8a2a3a, // crimson
  Y: 0x4f4214,
  y: 0xb8962a, // gold
}

// Hood color by level: [body, edge] palette keys
const HOODS = [
  [1, 'H', 'h'],
  [3, 'N', 'n'],
  [5, 'P', 'p'],
  [7, 'X', 'x'],
  [9, 'Y', 'y'],
]

export function hoodFor(level) {
  let pick = HOODS[0]
  for (const h of HOODS) if (level >= h[0]) pick = h
  return pick
}

// The scene without the screen's contents, the eye, or the hands
const BASE = [
  '............................',
  '....hhhhh....mmmmmmmmmmmmmmm',
  '...hHHHHHhh..MMSSSSSSSSSSSMM',
  '..hHHHHHhFFh.MMSSSSSSSSSSSMM',
  '..hHHHHHhFFF.MMSSSSSSSSSSSMM',
  '..hHHHHhFFEF.MMSSSSSSSSSSSMM',
  '..hHHHHhFFFF.MMSSSSSSSSSSSMM',
  '..hHHHHHhFFg.MMSSSSSSSSSSSMM',
  '..hHHHHHHhh..MMSSSSSSSSSSSMM',
  '.hHHHHHHHHHH.MMSSSSSSSSSSSMM',
  '.hHHHHHHHHHHHMMSSSSSSSSSSSMM',
  '.hHHHHHHHHHHHMMSSSSSSSSSSSMM',
  '.hHHHHHHHHHHHMMMMMMMMMMMMMMM',
  '.hHHHHHHHH..........MMM.....',
  '.hHHHHHHHHkkkkkkk.MMMMMMM...',
  'dddddddddddddddddddddddddddd',
  'DDDDDDDDDDDDDDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDDDDDDDDDDDDDD',
]

// The screen's inside: 11 pixels wide, 10 tall, at column 15, row 2
const SX = 15
const SY = 2
const SW = 11
const SH = 10

const ICONS = {
  check: [
    '...........',
    '.........G.',
    '........GG.',
    '.......GG..',
    '.G....GG...',
    '.GG..GG....',
    '..GGGG.....',
    '...GG......',
    '...........',
    '...........',
  ],
  cross: [
    '...........',
    '.RR.....RR.',
    '..RR...RR..',
    '...RR.RR...',
    '....RRR....',
    '...RR.RR...',
    '..RR...RR..',
    '.RR.....RR.',
    '...........',
    '...........',
  ],
  bang: [
    '...........',
    '....WW.....',
    '....WW.....',
    '....WW.....',
    '....WW.....',
    '....WW.....',
    '...........',
    '....WW.....',
    '...........',
    '...........',
  ],
  lens: ['.GGG..', 'G...G.', 'G...G.', '.GGG..', '....G.', '.....G'],
  up: [
    '.....G.....',
    '....GGG....',
    '...GGGGG...',
    '..GGGGGGG..',
    '....GGG....',
    '....GGG....',
    '....GGG....',
    '...........',
    '...........',
    '...........',
  ],
  prompt: ['G..', '.G.', 'G..'],
}

// A small deterministic hash, so scrolling code looks random but repeats
function hash(n) {
  let x = (n * 2654435761) >>> 0
  x ^= x >>> 15
  return x >>> 0
}

function blankScreen(fill) {
  return Array.from({ length: SH }, () => fill.repeat(SW))
}

function put(screen, x, y, art) {
  art.forEach((line, i) => {
    const row = y + i
    if (row < 0 || row >= SH) return
    const chars = screen[row].split('')
    for (let j = 0; j < line.length; j++) {
      const col = x + j
      if (line[j] !== '.' && col >= 0 && col < SW) chars[col] = line[j]
    }
    screen[row] = chars.join('')
  })
}

// Lines of "code" on every other pixel row, scrolled by `offset`
function code(screen, offset, bright) {
  for (let i = 0; i < SH; i += 2) {
    const n = hash(Math.floor(i / 2) + offset)
    const indent = n % 3
    const first = 1 + ((n >>> 3) % 3)
    const rest = (n >>> 6) % 5
    let line = ' '.repeat(indent) + (bright ? 'G' : 'g').repeat(first)
    if (rest) line += ' ' + (bright ? 'c' : 'g').repeat(rest)
    put(screen, 0, i, [line.replace(/ /g, '.')])
  }
}

function screenFor(state, frame) {
  const s = blankScreen('S')
  switch (state) {
    case 'EDITING':
    case 'WORKING': {
      code(s, Math.floor(frame / 2), true)
      // The cursor blinks on the last line
      if (frame % 2) put(s, 9, SH - 2, ['G'])
      return s
    }
    case 'SCANNING': {
      code(s, 3, false)
      const x = [0, 2, 4, 5, 4, 2][frame % 6]
      put(s, x, 2, ICONS.lens)
      return s
    }
    case 'EXEC':
    case 'SPAWNING': {
      put(s, 1, 1, ICONS.prompt)
      if (frame % 2) put(s, 5, 3, ['GGG'])
      // Output lines appear under the prompt
      const shown = frame % 6
      for (let i = 0; i < Math.min(shown, 3); i++) put(s, 1, 5 + i * 2, ['g'.repeat(2 + (hash(i) % 7))])
      return s
    }
    case 'THINKING': {
      const lit = Math.floor(frame / 2) % 3
      put(s, 2, 5, [[0, 1, 2].map((i) => (i === lit ? 'G' : 'g')).join('..')])
      return s
    }
    case 'ALERT': {
      const red = blankScreen(frame % 2 ? 'r' : 'S')
      put(red, 0, 0, ICONS.bang)
      return red
    }
    case 'DONE':
      put(s, 0, 0, ICONS.check)
      return s
    case 'STOPPED':
      put(s, 0, 0, ICONS.cross)
      return s
    case 'SLEEP':
      return blankScreen('O')
    case 'LEVELUP': {
      put(s, 0, (frame % 4) - 1, ICONS.up)
      // Sparkles in the corners
      const sp = frame % 2 ? 'G' : 'c'
      put(s, frame % 2 ? 0 : 9, 1, [sp])
      put(s, frame % 2 ? 10 : 1, 7, [sp])
      return s
    }
    default: {
      // Idle: a prompt with a slow cursor
      put(s, 1, 1, ICONS.prompt)
      if (Math.floor(frame / 3) % 2) put(s, 5, 3, ['GGG'])
      return s
    }
  }
}

function paint(grid, row, col, text) {
  const chars = grid[row].split('')
  for (let i = 0; i < text.length; i++) if (text[i] !== '.') chars[col + i] = text[i]
  grid[row] = chars.join('')
}

// The 18 pixel rows for a state and frame. `opts.level` picks the hood color,
// `opts.night` puts a coffee mug on the desk and makes the eye tired.
export function pixels(state, frame, opts) {
  opts = opts || {}
  const [, body, edge] = hoodFor(opts.level || 1)
  let grid = BASE.slice()
  if (body !== 'H') grid = grid.map((r) => r.replace(/H/g, body).replace(/h/g, edge))
  const screen = screenFor(state, frame)
  screen.forEach((line, i) => (grid[SY + i] = grid[SY + i].slice(0, SX) + line + grid[SY + i].slice(SX + SW)))

  // The eye, and the screen's glow on the face
  const blink = frame % 16 === 0
  const tired = opts.night && frame % 8 < 3
  const eye =
    state === 'ALERT' || state === 'STOPPED' ? 'R' : state === 'SLEEP' || blink ? 'e' : tired ? 'c' : 'E'
  paint(grid, 5, 10, eye)

  // Night: a coffee mug beside the monitor, steam rising between frames
  if (opts.night) {
    paint(grid, 13, 24, 'uuuU')
    paint(grid, 14, 24, 'uuu.')
    if (state !== 'SLEEP') paint(grid, frame % 2 ? 12 : 13, 25, 'w')
  }
  if (state !== 'SLEEP') paint(grid, 7, 11, state === 'ALERT' ? 'r' : 'g')

  // Hands on the keyboard; they take turns while typing
  const typing = state === 'EDITING' || state === 'WORKING' || state === 'EXEC'
  paint(grid, 13, 10, typing && frame % 2 ? '.KK.' : 'KK.K')

  // Shake on alert: shift the whole scene one pixel right
  if (state === 'ALERT' && frame % 2) return grid.map((r) => '.' + r.slice(0, WIDTH - 1))
  return grid
}

// Blow the grid up k times in both directions (nearest neighbor, crisp pixels)
export function scaleGrid(grid, k) {
  if (k <= 1) return grid
  const out = []
  for (const row of grid) {
    const wide = row.replace(/./g, (ch) => ch.repeat(k))
    for (let i = 0; i < k; i++) out.push(wide)
  }
  return out
}

// The largest whole scale that fits `columns`, capped at `max`
export function scaleFor(columns, max) {
  return Math.max(1, Math.min(max || 3, Math.floor(columns / WIDTH)))
}

// Pack pixel rows into a Raster's base64 cells, two pixel rows per cell row
export function cellsOf(grid) {
  const numbers = []
  const width = grid[0].length
  for (let r = 0; r + 1 < grid.length; r += 2) {
    for (let c = 0; c < width; c++) {
      const top = PALETTE[grid[r][c]] ?? NONE
      const bottom = PALETTE[grid[r + 1][c]] ?? NONE
      if (top === NONE && bottom === NONE) numbers.push(32, NONE, NONE)
      else if (top === NONE) numbers.push(0x2584, bottom, NONE) // ▄
      else numbers.push(0x2580, top, bottom) // ▀
    }
  }
  return new Uint8Array(Uint32Array.from(numbers).buffer).toBase64()
}

// What the Desktop app shows instead, since it has no Raster: one rect per pixel
export function asSvg(grid) {
  const hex = (n) => '#' + n.toString(16).padStart(6, '0')
  let rects = ''
  for (let r = 0; r < HEIGHT; r++) {
    for (let c = 0; c < WIDTH; c++) {
      const color = PALETTE[grid[r][c]]
      if (color === undefined || color === NONE) continue
      rects += '<rect x="' + c + '" y="' + r + '" width="1" height="1" fill="' + hex(color) + '"/>'
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '" shape-rendering="crispEdges">' +
    rects +
    '</svg>'
  )
}

// A truecolor ANSI rendering, for previewing the sprite in a plain terminal
export function asAnsi(grid) {
  const rgb = (n) => (n >> 16) + ';' + ((n >> 8) & 255) + ';' + (n & 255)
  const lines = []
  for (let r = 0; r + 1 < grid.length; r += 2) {
    let line = ''
    for (let c = 0; c < grid[0].length; c++) {
      const top = PALETTE[grid[r][c]] ?? NONE
      const bottom = PALETTE[grid[r + 1][c]] ?? NONE
      if (top === NONE && bottom === NONE) line += '\x1b[0m '
      else if (top === NONE) line += '\x1b[0m\x1b[38;2;' + rgb(bottom) + 'm▄'
      else line += '\x1b[38;2;' + rgb(top) + 'm' + (bottom === NONE ? '\x1b[49m' : '\x1b[48;2;' + rgb(bottom) + 'm') + '▀'
    }
    lines.push(line + '\x1b[0m')
  }
  return lines.join('\n')
}

// A one-line face for when there's no room for the scene
export function face(state) {
  return (
    {
      ALERT: '(⊙_⊙)!',
      STOPPED: '(x_x)',
      DONE: '(^_^)',
      LEVELUP: '(★_★)',
      SLEEP: '(-_-) zZ',
      SCANNING: '(o_o)>',
      EDITING: '(•_•)⌨',
      EXEC: '(•_•)>_',
      THINKING: '(•_•)…',
    }[state] || '(•_•)'
  )
}
