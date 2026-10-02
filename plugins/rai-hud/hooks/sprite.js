// The mascot: a rottweiler hacker in a hoodie at a laptop. The dog is pixel art
// generated from art/rottweiler.png (see art/build_dog.py -> dogart.js); the
// laptop, desk, eye and every effect are drawn here, so the screen animates
// with Claude's state. Each terminal cell holds two pixel rows
// (half blocks: top pixel = foreground, bottom = background). Pure functions only.

import { DOG, RIM, EYE } from './dogart.js'

// The terminal's default color, used for transparent pixels
const NONE = 0x01000000

const PALETTE = {
  '.': NONE,
  // Lens colors
  E: 0x00ff9c, // green glow
  e: 0x0d6b47, // dim
  c: 0x14a86f, // tired
  R: 0xff3355, // red
  r: 0x4a0d18, // red screen
  w: 0xffe8ec, // white
  // Laptop and desk
  M: 0x252b38, // bezel
  m: 0x343c4f, // bezel edge
  k: 0x3a4152, // keyboard deck
  K: 0x2a303d, // deck shade
  S: 0x04130d, // screen
  O: 0x07080b, // screen off
  d: 0x2f3542, // desk edge
  D: 0x171b23, // desk
  // Screen inks
  G: 0x00ff9c, // green
  g: 0x0d6b47, // dim green
  C: 0x22d3ee, // cyan
  x: 0x0e5560, // dim cyan
  Y: 0xfacc15, // yellow
  y: 0x6b5a10, // dim yellow
  Q: 0xe879f9, // magenta
  q: 0x5e2a63, // dim magenta
  // Night mug, steam, zZ
  u: 0xa8714c,
  U: 0x6e4a33,
  s: 0x9aa3b5,
  // The dog's eye
  n: 0x3a2412, // open: dark brown
  N: 0xd8dae4, // shine
  z: 0x26262e, // closed
  // The dog's outline, by level
  [RIM]: 0x6a6a86, // gray
  'µ': 0x2f9e6b, // green
  '¶': 0x8b5cf6, // purple
  '·': 0xdc2f4b, // crimson
  '¸': 0xe0b43a, // gold
}
// The dog's own colors (both sizes use separate keys)
for (const size of Object.values(DOG)) for (const [k, hex] of Object.entries(size.palette)) PALETTE[k] = parseInt(hex, 16)

// Outline color by level: [from level, key]
const RIMS = [
  [1, RIM],
  [3, 'µ'],
  [5, '¶'],
  [7, '·'],
  [9, '¸'],
]

export function rimFor(level) {
  let pick = RIMS[0]
  for (const r of RIMS) if (level >= r[0]) pick = r
  return pick[1]
}

// ── Layout of each size ────────────────────────────────────────────────────
// W x H canvas; the dog sits at the left, bottom-anchored behind the desk; the
// laptop faces the viewer on the right with its screen at `screen`.
const SIZES = {
  full: {
    W: 60,
    H: 36,
    dog: DOG.full,
    dogAt: [0, 3],
    bezel: { x: 42, y: 12, w: 17, h: 15 },
    screen: { x: 43, y: 13, w: 15, h: 13 },
    deck: [
      [27, 41, 58, 'k'],
      [28, 40, 57, 'k'],
      [29, 39, 56, 'K'],
    ],
    deskRow: 30,
    sparks: { rows: [22, 28], cols: [34, 40] },
    mug: { x: 57, y: 28 },
    zz: { x: 30, y: 2 },
    thick: 2,
  },
  mini: {
    W: 30,
    H: 20,
    dog: DOG.mini,
    dogAt: [0, 3],
    bezel: { x: 21, y: 6, w: 9, h: 9 },
    screen: { x: 22, y: 7, w: 7, h: 7 },
    deck: [[15, 19, 29, 'k']],
    deskRow: 16,
    sparks: { rows: [12, 15], cols: [18, 20] },
    mug: null,
    zz: { x: 16, y: 1 },
    thick: 1,
  },
}

export function dims(size) {
  const s = SIZES[size] || SIZES.full
  return { width: s.W, height: s.H, rows: s.H / 2 }
}

export const WIDTH = SIZES.full.W
export const HEIGHT = SIZES.full.H
export const ROWS = HEIGHT / 2

// The size that fits a sidebar this many columns wide
export function sizeFor(columns) {
  return columns >= SIZES.full.W ? 'full' : 'mini'
}

// The largest whole scale of `size` that fits `columns`, capped at `max`
export function scaleFor(columns, max, size) {
  const w = (SIZES[size] || SIZES.full).W
  return Math.max(1, Math.min(max || 3, Math.floor(columns / w)))
}

// ── Screen contents ────────────────────────────────────────────────────────

// [bright, dim] inks by mood, matching the tool tags in the transcript
function inkFor(state) {
  if (state === 'SCANNING') return ['C', 'x']
  if (state === 'EXEC' || state === 'SPAWNING') return ['Y', 'y']
  if (state === 'NET') return ['Q', 'q']
  return ['G', 'g']
}

function hash(n) {
  let x = (n * 2654435761) >>> 0
  x ^= x >>> 15
  return x >>> 0
}

function blank(w, h, fill) {
  return Array.from({ length: h }, () => Array(w).fill(fill))
}

function dot(s, x, y, ch) {
  if (y >= 0 && y < s.length && x >= 0 && x < s[0].length) s[y][x] = ch
}

function line(s, x0, y0, x1, y1, ch, thick) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps)
    const y = Math.round(y0 + ((y1 - y0) * i) / steps)
    for (let t = 0; t < thick; t++) dot(s, x + t, y, ch)
  }
}

// Lines of "code" on every other row, scrolled by `offset`
function code(s, offset, bright, dim) {
  const w = s[0].length
  for (let i = 0; i < s.length; i += 2) {
    const n = hash(Math.floor(i / 2) + offset)
    const indent = n % 3
    const a = 1 + ((n >>> 3) % Math.max(2, Math.floor(w / 4)))
    const b = (n >>> 6) % Math.max(2, Math.floor(w / 2))
    for (let j = 0; j < a; j++) dot(s, indent + j, i, bright)
    for (let j = 0; j < b; j++) dot(s, indent + a + 1 + j, i, dim)
  }
}

function screenFor(state, frame, w, h, thick) {
  const [ink, dim] = inkFor(state)
  const s = blank(w, h, 'S')
  const prompt = () => {
    dot(s, 1, 1, ink)
    dot(s, 2, 2, ink)
    dot(s, 1, 3, ink)
  }
  switch (state) {
    case 'EDITING':
    case 'WORKING': {
      code(s, Math.floor(frame / 2), ink, dim)
      if (frame % 2) dot(s, w - 2, h - 2, ink)
      return s
    }
    case 'SCANNING': {
      code(s, 3, dim, dim)
      const r = Math.max(1, Math.floor(Math.min(w, h) / 5))
      const cx = r + 1 + ((frame % 6) * (w - 2 * r - 3)) / 5
      const cy = Math.floor(h / 3)
      for (let a = 0; a < 16; a++) dot(s, Math.round(cx + r * Math.cos((a * Math.PI) / 8)), Math.round(cy + r * Math.sin((a * Math.PI) / 8)), ink)
      line(s, Math.round(cx + r * 0.7), Math.round(cy + r * 0.7), Math.round(cx + r * 1.8), Math.round(cy + r * 1.8), ink, 1)
      return s
    }
    case 'EXEC':
    case 'SPAWNING': {
      prompt()
      if (frame % 2) line(s, 4, 3, Math.min(w - 2, 6), 3, ink, 1)
      for (let i = 0; i < Math.min(frame % 6, Math.floor((h - 5) / 2)); i++) line(s, 1, 5 + i * 2, 1 + (hash(i) % (w - 3)), 5 + i * 2, dim, 1)
      return s
    }
    case 'NET': {
      const r = Math.floor(Math.min(w, h) / 2) - 1
      const cx = Math.floor(w / 2)
      const cy = Math.floor(h / 2)
      for (let a = 0; a < 24; a++) dot(s, Math.round(cx + r * Math.cos((a * Math.PI) / 12)), Math.round(cy + r * Math.sin((a * Math.PI) / 12)), dim)
      line(s, cx - r, cy, cx + r, cy, dim, 1)
      line(s, cx, cy - r, cx, cy + r, dim, 1)
      const a = (frame * Math.PI) / 4
      dot(s, Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)), ink)
      return s
    }
    case 'THINKING': {
      const lit = Math.floor(frame / 2) % 3
      const y = Math.floor(h / 2)
      for (let i = 0; i < 3; i++) for (let t = 0; t < thick; t++) dot(s, Math.floor(w / 2) - 3 * thick + i * 3 * thick + t, y, i === lit ? ink : dim)
      return s
    }
    case 'ALERT': {
      const red = blank(w, h, frame % 2 ? 'r' : 'S')
      const x = Math.floor(w / 2) - Math.floor(thick / 2)
      line(red, x, 1, x, Math.floor(h * 0.6), 'w', thick)
      line(red, x, Math.floor(h * 0.75), x, Math.floor(h * 0.75) + thick - 1, 'w', thick)
      return red
    }
    case 'DONE':
      line(s, Math.floor(w * 0.12), Math.floor(h * 0.5), Math.floor(w * 0.4), Math.floor(h * 0.78), 'G', thick)
      line(s, Math.floor(w * 0.4), Math.floor(h * 0.78), Math.floor(w * 0.85), Math.floor(h * 0.18), 'G', thick)
      return s
    case 'STOPPED':
      line(s, 1, 1, w - 1 - thick, h - 2, 'R', thick)
      line(s, w - 1 - thick, 1, 1, h - 2, 'R', thick)
      return s
    case 'LEVELUP': {
      const cx = Math.floor(w / 2)
      const top = 1 + (frame % 3)
      const half = Math.floor(w / 3)
      for (let i = 0; i <= half; i++) line(s, cx - i, top + i, cx + i, top + i, 'Y', 1)
      line(s, cx - 1, top + half, cx - 1, Math.min(h - 2, top + half + Math.floor(h / 3)), 'Y', Math.max(2, thick + 1))
      dot(s, frame % 2 ? 1 : w - 2, 1, 'w')
      dot(s, frame % 2 ? w - 2 : 1, h - 3, 'w')
      return s
    }
    case 'SLEEP':
      return blank(w, h, 'O')
    case 'BOOT': {
      const lines = Math.min(frame, Math.floor((h - 3) / 2))
      for (let i = 0; i < lines; i++) line(s, 0, i * 2, 1 + (hash(i + 7) % (w - 2)), i * 2, 'g', 1)
      const fill = Math.min(w - 2, Math.max(0, frame - 2) * Math.ceil(w / 5))
      line(s, 0, h - 2, w - 1, h - 2, 'g', 1)
      if (fill) line(s, 0, h - 2, fill, h - 2, 'G', 1)
      return s
    }
    default:
      prompt()
      if (Math.floor(frame / 3) % 2) line(s, 4, 3, Math.min(w - 2, 6), 3, ink, 1)
      return s
  }
}

// Whether the eye is closed: asleep, stopped, blinking, or drowsy at night
function eyeClosed(state, frame, night) {
  if (state === 'SLEEP' || state === 'STOPPED') return true
  if (state === 'BOOT') return frame < 4
  if (frame % 16 === 0) return true
  return night && frame % 12 < 2
}

// ── Assembling a frame ─────────────────────────────────────────────────────

// The pixel rows for a state and frame. Options:
//   size: 'full' | 'mini'; level: outline color; night: mug + tired lens
export function pixels(state, frame, opts) {
  opts = opts || {}
  const S = SIZES[opts.size] || SIZES.full
  const g = Array.from({ length: S.H }, () => Array(S.W).fill('.'))
  const set = (r, c, ch) => {
    if (r >= 0 && r < S.H && c >= 0 && c < S.W) g[r][c] = ch
  }

  // The dog: outline by level; the eye open (with a shine) or closed
  const rim = rimFor(opts.level || 1)
  const closed = eyeClosed(state, frame, opts.night)
  const [dx, dy] = S.dogAt
  // Each art pixel is a k x k block, for the chunky look
  const k = S.dog.scale || 1
  let shone = false
  S.dog.rows.forEach((row, i) => {
    const chars = [...row]
    for (let j = 0; j < chars.length; j++) {
      const ch = chars[j]
      if (ch === '.') continue
      const out = ch === RIM ? rim : ch === EYE ? (closed ? 'z' : 'n') : ch
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) set(dy + i * k + a, dx + j * k + b, out)
      // One white glint at the top-left of the open eye
      if (ch === EYE && !closed && !shone) {
        set(dy + i * k, dx + j * k, 'N')
        shone = true
      }
    }
  })

  // Laptop: bezel, screen, keyboard deck
  const B = S.bezel
  for (let i = 0; i < B.h; i++) for (let j = 0; j < B.w; j++) set(B.y + i, B.x + j, i === 0 || j === 0 ? 'm' : 'M')
  const scr = screenFor(state, frame, S.screen.w, S.screen.h, S.thick)
  for (let i = 0; i < S.screen.h; i++) for (let j = 0; j < S.screen.w; j++) set(S.screen.y + i, S.screen.x + j, scr[i][j])
  for (const [r, c0, c1, ch] of S.deck) for (let c = c0; c <= c1; c++) set(r, c, ch)

  // Desk across the bottom, in front of the dog
  for (let c = 0; c < S.W; c++) set(S.deskRow, c, 'd')
  for (let r = S.deskRow + 1; r < S.H; r++) for (let c = 0; c < S.W; c++) set(r, c, 'D')

  // Sparks off the keyboard while editing
  if (state === 'EDITING') {
    const [r0, r1] = S.sparks.rows
    const [c0, c1] = S.sparks.cols
    for (let i = 0; i < 3; i++) {
      const n = hash(frame * 31 + i)
      const r = r0 + (n % (r1 - r0 + 1))
      const c = c0 + ((n >>> 4) % (c1 - c0 + 1))
      if (g[r][c] === '.') g[r][c] = i ? 'G' : 'w'
    }
  }

  // Night: a coffee mug with steam
  if (opts.night && S.mug) {
    const { x, y } = S.mug
    set(y, x, 'u')
    set(y, x + 1, 'U')
    set(y + 1, x, 'u')
    set(y + 1, x + 1, 'u')
    if (state !== 'SLEEP' && frame % 2) set(y - 1, x, 's')
  }

  // Sleep: a z drifting up
  if (state === 'SLEEP') {
    const { x, y } = S.zz
    const lift = frame % 3
    const z = S === SIZES.full ? ['ssss', '..s.', '.s..', 'ssss'] : ['ss', '.s', 'ss']
    z.forEach((line, i) => {
      for (let j = 0; j < line.length; j++) {
        const r = y + i + 2 - lift
        if (line[j] !== '.' && g[r] && g[r][x + j] === '.') g[r][x + j] = line[j]
      }
    })
  }

  // Matrix rain in the empty background while Claude works
  const working = ['THINKING', 'SCANNING', 'EDITING', 'WORKING', 'EXEC', 'SPAWNING', 'NET'].includes(state)
  if (working) {
    for (let c = 0; c < S.W; c += 2) {
      const n = hash(c * 7 + 3)
      if (n % 3) continue
      const speed = 1 + (n % 2)
      const head = (frame * speed + (n % S.deskRow)) % (S.deskRow + 4)
      for (let t = 0; t < 3; t++) {
        const r = head - t
        if (r >= 0 && r < S.deskRow && g[r][c] === '.') g[r][c] = t ? 'g' : 'G'
      }
    }
  }

  let rows = g.map((r) => r.join(''))

  // Glitch on alert: some rows jump sideways
  if (state === 'ALERT') {
    rows = rows.map((r, i) => {
      const n = hash(i * 13 + frame * 101)
      if (n % 5) return r
      const shift = n % 2 ? 1 : 2
      return n % 4 < 2 ? '.'.repeat(shift) + r.slice(0, r.length - shift) : r.slice(shift) + '.'.repeat(shift)
    })
  }
  return rows
}

// Blow the grid up k times in both directions (nearest neighbor, crisp pixels)
export function scaleGrid(grid, k) {
  if (k <= 1) return grid
  const out = []
  for (const row of grid) {
    let wide = ''
    for (const ch of row) wide += ch.repeat(k)
    for (let i = 0; i < k; i++) out.push(wide)
  }
  return out
}

// CRT scanlines: dim the bottom pixel of every cell a little
function dim(color) {
  if (color === NONE) return NONE
  const f = 0.72
  return (Math.round(((color >> 16) & 255) * f) << 16) | (Math.round(((color >> 8) & 255) * f) << 8) | Math.round((color & 255) * f)
}

// Pack pixel rows into a Raster's base64 cells, two pixel rows per cell row.
// An odd final row is padded with transparency.
export function cellsOf(grid, opts) {
  const crt = opts && opts.crt
  const numbers = []
  const width = grid[0].length
  for (let r = 0; r < grid.length; r += 2) {
    for (let c = 0; c < width; c++) {
      const top = PALETTE[grid[r][c]] ?? NONE
      let bottom = grid[r + 1] ? (PALETTE[grid[r + 1][c]] ?? NONE) : NONE
      if (crt) bottom = dim(bottom)
      if (top === NONE && bottom === NONE) numbers.push(32, NONE, NONE)
      else if (top === NONE) numbers.push(0x2584, bottom, NONE) // ▄
      else numbers.push(0x2580, top, bottom) // ▀
    }
  }
  return new Uint8Array(Uint32Array.from(numbers).buffer).toBase64()
}

// What the Desktop app shows instead, since it has no Raster: one rect per pixel
export function asSvg(grid, opts) {
  const crt = opts && opts.crt
  const hex = (n) => '#' + n.toString(16).padStart(6, '0')
  let rects = ''
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      let color = PALETTE[grid[r][c]]
      if (color === undefined || color === NONE) continue
      if (crt && r % 2) color = dim(color)
      rects += '<rect x="' + c + '" y="' + r + '" width="1" height="1" fill="' + hex(color) + '"/>'
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + grid[0].length + ' ' + grid.length + '" shape-rendering="crispEdges">' +
    rects +
    '</svg>'
  )
}

// A truecolor ANSI rendering, for previewing the sprite in a plain terminal
export function asAnsi(grid) {
  const rgb = (n) => (n >> 16) + ';' + ((n >> 8) & 255) + ';' + (n & 255)
  const lines = []
  for (let r = 0; r < grid.length; r += 2) {
    let out = ''
    for (let c = 0; c < grid[0].length; c++) {
      const top = PALETTE[grid[r][c]] ?? NONE
      const bottom = grid[r + 1] ? (PALETTE[grid[r + 1][c]] ?? NONE) : NONE
      if (top === NONE && bottom === NONE) out += '\x1b[0m '
      else if (top === NONE) out += '\x1b[0m\x1b[38;2;' + rgb(bottom) + 'm▄'
      else out += '\x1b[38;2;' + rgb(top) + 'm' + (bottom === NONE ? '\x1b[49m' : '\x1b[48;2;' + rgb(bottom) + 'm') + '▀'
    }
    lines.push(out + '\x1b[0m')
  }
  return lines.join('\n')
}

// The palette as hex strings, for preview tools
export function paletteHex() {
  const out = {}
  for (const [k, v] of Object.entries(PALETTE)) out[k] = v === NONE ? null : '#' + v.toString(16).padStart(6, '0')
  return out
}

// A one-line dog face for when there's no room for the scene
export function face(state) {
  return (
    {
      ALERT: 'U⊙ᴥ⊙U!',
      STOPPED: 'Ux_xU',
      DONE: 'U^ᴥ^U',
      LEVELUP: 'U★ᴥ★U',
      SLEEP: 'U-ᴥ-U zZ',
      SCANNING: 'U•ᴥ•U>',
      EDITING: 'U•ᴥ•U⌨',
      EXEC: 'U•ᴥ•U>_',
      NET: 'U•ᴥ•U@',
      THINKING: 'U•ᴥ•U…',
      BOOT: 'U·ᴥ·U',
    }[state] || 'U•ᴥ•U'
  )
}
