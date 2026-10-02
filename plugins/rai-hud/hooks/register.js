// rai-hud: an always-on, terminal-ops styled HUD for Claude Code. It shows only
// what ccstatusline and Claude Code's own UI don't (no cwd, branch, context, or
// time).
//
// Zero tokens: nothing here calls a model or adds text Claude reads. The pane,
// band, toast, and spinner suffix are drawn locally, and the git guard's `deny`
// text is the only thing Claude ever sees (as a tool result, only when you block).

import { WIDTH, ROWS, pixels, cellsOf, asSvg, scaleGrid, scaleFor, face } from './sprite.js'
import { findSecret, envValues, isSecretHome, mask, parseWindowsPorts, parseLsofPorts, portHint } from './scan.js'

// ── Pane and mascot ────────────────────────────────────────────────────────
const PANE = 'rai-hud'
const FRAME_MS = 250
const SLEEP_AFTER_MS = 2 * 60 * 1000
const GIT_POLL_MS = 30 * 1000
const CI_POLL_MS = 60 * 1000
const PORT_POLL_MS = 20 * 1000
let paneOpen = false
// Whether the surface actually drew the pane. Opened unasked, it waits for a
// terminal 144 columns wide; opened behind your prompt, it shows at any width.
let placed = false
// You closed it yourself (/hud or Esc): don't reopen it on the next prompt
let userClosed = false
const TABS = ['tasks', 'files', 'cmds', 'git', 'ci', 'ports']
let tab = 'tasks'
let mood = 'IDLE'
let moodUntil = 0 // when a timed mood (DONE, STOPPED) falls back to IDLE
let lastActivity = 0
let target = '' // what Claude last touched, e.g. "auth.ts"
let frame = 0
let lastCells = ''
// How the last render drew the mascot: scale 0 means it isn't on screen
let spriteScale = 1

const MOOD_COLOR = {
  IDLE: 'green',
  THINKING: 'green',
  SCANNING: 'cyan',
  EDITING: 'green',
  WORKING: 'green',
  EXEC: 'yellow',
  SPAWNING: 'magenta',
  ALERT: 'red',
  DONE: 'green',
  STOPPED: 'red',
  SLEEP: 'gray',
  LEVELUP: 'yellow',
}

const MOOD_LINE = {
  IDLE: 'awaiting input',
  THINKING: 'computing...',
  SCANNING: 'scanning target',
  EDITING: 'injecting code',
  WORKING: 'running op',
  EXEC: 'shell exec',
  SPAWNING: 'spawning agent',
  ALERT: 'intrusion check!',
  DONE: 'op complete',
  STOPPED: 'op aborted',
  SLEEP: 'zZz',
  LEVELUP: 'LEVEL UP!',
}

// ── XP and levels ──────────────────────────────────────────────────────────
// Level n needs 25*n*(n-1) XP: 50, 150, 300, 500, 750, 1050, 1400, 1800, 2250…
const TITLES = [
  'script kiddie',
  'packet sniffer',
  'shell jockey',
  'exploit dev',
  'netrunner',
  'root hunter',
  'zero-day',
  'ghost',
  'mainframe legend',
  'the architect',
]
let xp = 0
let muted = false

function xpFor(level) {
  return 25 * level * (level - 1)
}

function levelOf(points) {
  let level = 1
  while (xpFor(level + 1) <= points) level += 1
  return level
}

function titleOf(level) {
  return TITLES[Math.min(level, TITLES.length) - 1]
}

// XP for one finished turn: some for showing up, more for real work
function xpForTurn(tools, files) {
  return 5 + Math.min(tools, 20) + 3 * Math.min(files, 10)
}

// Night mode: midnight to 5am, local time
function isNight() {
  return new Date().getHours() < 5
}

function nightLine() {
  const d = new Date()
  return '[!] ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' :: go to sleep'
}

const SCAN_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'LSP']
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit']
const SHELL_TOOLS = ['Bash', 'PowerShell']
const TASK_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite']

// ── Session facts ──────────────────────────────────────────────────────────
let interactive = true
let isWindows = false
let repoRoot = ''
// Real secret values from the repo's .env files, to catch verbatim leaks
let envSecrets = []
let branch = ''

// The turn in progress, for the spinner and the band
let busy = false
let toolCalls = 0
let turnFiles = new Set()
let last = null

// ── Sidebar data ───────────────────────────────────────────────────────────
// 1: Claude's plan, from its task tools. { key, subject, status }
let plan = []
// 2: files Claude changed this session. path -> { add, del, isNew }
const files = new Map()
// 3: recent shell commands. { at, cmd, state: 'run' | 'ok' | 'fail' | 'deny' }
let cmds = []
// 4: push state
let git = { upstream: '', ahead: 0, behind: 0, stash: 0, unpushed: [], fetching: false }
// 5: the branch's pull request and its checks
let ci = { pr: null, checks: [], error: '', loading: false, checkedAt: 0 }
// 6: dev servers listening on this machine. { port, name, pid }
let ports = []

// ── Helpers (pure) ─────────────────────────────────────────────────────────
function moodForTool(tool) {
  if (SCAN_TOOLS.includes(tool)) return 'SCANNING'
  if (EDIT_TOOLS.includes(tool)) return 'EDITING'
  if (SHELL_TOOLS.includes(tool)) return 'EXEC'
  if (tool === 'Agent') return 'SPAWNING'
  return 'WORKING'
}

function clip(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function baseName(p) {
  return String(p).split(/[\\/]/).pop()
}

function targetOf(e) {
  const raw = e.file_path || e.path || e.pattern || e.command || e.url || e.description || ''
  const s = String(raw)
  return clip(/[\\/]/.test(s) && !/\s/.test(s) ? baseName(s) : s, 22)
}

// Path relative to the repo root, with forward slashes; lowercased key for matching
function relPath(abs) {
  const norm = String(abs).replace(/\\/g, '/')
  const root = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  return root && norm.toLowerCase().startsWith(root.toLowerCase() + '/') ? norm.slice(root.length + 1) : norm
}

// The ci tab's badge: ✓, ✗2, or … while checks run
function ciBadge() {
  if (!ci.pr) return ''
  const fail = ci.checks.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel').length
  const pend = ci.checks.filter((c) => c.bucket === 'pending').length
  if (fail) return ' ✗' + fail
  if (pend) return ' …'
  return ci.checks.length ? ' ✓' : ' #' + ci.pr.number
}

function fmtTokens(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

function clock(ms) {
  return new Date(ms).toTimeString().slice(0, 8)
}

// Which risky git action a shell command is, or null
function riskOf(command) {
  if (!/\bgit\b/.test(command)) return null
  if (/\bgit\s+push\b[^;&|]*(\s--force\b|\s--force-with-lease\b|\s-f\b|\s\+\S)/.test(command)) return 'FORCE_PUSH'
  if (/\bgit\s+push\b/.test(command)) return 'PUSH'
  if (/\bgit\s+reset\s+[^;&|]*--hard\b/.test(command)) return 'HARD_RESET'
  if (/\bgit\s+clean\s+[^;&|]*-\w*f/.test(command)) return 'GIT_CLEAN'
  if (/\bgit\s+commit\b/.test(command) && (branch === 'main' || branch === 'master')) return 'COMMIT_ON_' + branch.toUpperCase()
  return null
}

// Fold a task tool call into the plan
function applyTaskCall(e, result) {
  if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) {
    plan = e.todos.map((t, i) => ({ key: 'todo-' + i, subject: t.content, status: t.status }))
  } else if (e.tool === 'TaskCreate') {
    const id = result && result.task && result.task.id
    if (id) plan = [...plan, { key: String(id), subject: e.subject, status: 'pending' }]
  } else if (e.tool === 'TaskUpdate') {
    if (e.status === 'deleted') plan = plan.filter((t) => t.key !== String(e.taskId))
    else
      plan = plan.map((t) =>
        t.key === String(e.taskId) ? { ...t, status: e.status || t.status, subject: e.subject || t.subject } : t,
      )
  }
}

// ── Helpers that call the mods API ─────────────────────────────────────────
async function git$($, args, timeoutMs) {
  try {
    const r = await $.process.run(['git', ...args], { cwd: repoRoot || undefined, timeoutMs: timeoutMs || 5000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

// Branch and repo root; empty outside a repo
async function refreshBranch($) {
  try {
    const repo = await $.session.repo()
    repoRoot = repo ? repo.root : ''
  } catch {
    repoRoot = ''
  }
  if (!repoRoot) {
    branch = ''
    return
  }
  const out = await git$($, ['branch', '--show-current'])
  branch = out === null ? '' : out.trim() || '(detached)'
}

// Ahead/behind, stashes, and unpushed commits
async function refreshGitState($) {
  if (!repoRoot) {
    git = { ...git, upstream: '', ahead: 0, behind: 0, stash: 0, unpushed: [] }
    return
  }
  const up = await git$($, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const stash = await git$($, ['stash', 'list'])
  const next = { ...git, upstream: up ? up.trim() : '', ahead: 0, behind: 0, unpushed: [] }
  next.stash = stash ? stash.split('\n').filter(Boolean).length : 0
  if (next.upstream) {
    const counts = await git$($, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
    if (counts) {
      const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
      next.behind = behind || 0
      next.ahead = ahead || 0
    }
    const log = next.ahead ? await git$($, ['log', '@{u}..HEAD', '--format=%h %s', '-n', '6']) : ''
    next.unpushed = (log || '').split('\n').filter(Boolean)
  } else {
    const log = await git$($, ['log', '--format=%h %s', '-n', '6'])
    next.unpushed = (log || '').split('\n').filter(Boolean)
  }
  git = next
}

// +/- line counts for the files Claude touched
async function refreshFiles($) {
  if (!files.size || !repoRoot) return
  const paths = [...files.keys()]
  const stats = new Map()
  const numstat = await git$($, ['diff', '--numstat', 'HEAD', '--', ...paths])
  for (const line of (numstat || '').split('\n')) {
    const [add, del, p] = line.split('\t')
    if (p) stats.set(p.toLowerCase(), { add: Number(add) || 0, del: Number(del) || 0 })
  }
  const untracked = await git$($, ['ls-files', '--others', '--exclude-standard', '--', ...paths])
  const fresh = new Set((untracked || '').split('\n').filter(Boolean).map((p) => p.toLowerCase()))
  for (const p of paths) {
    const key = relPath(p).toLowerCase()
    const s = stats.get(key)
    files.set(p, { add: s ? s.add : 0, del: s ? s.del : 0, isNew: fresh.has(key) })
  }
}

// Change mood, and redraw the pane's text when it changes
async function setMood($, next, holdMs) {
  const now = await $.clock.now()
  lastActivity = now
  moodUntil = holdMs ? now + holdMs : 0
  if (next !== mood) {
    mood = next
    $.ui.invalidate('ui.render')
  }
}

// One animation tick: expire timed moods, doze off, and repaint the sprite
async function tick($) {
  if (!paneOpen) return
  frame += 1
  const now = await $.clock.now()
  if (moodUntil && now > moodUntil) await setMood($, 'IDLE')
  else if (!busy && mood === 'IDLE' && now - lastActivity > SLEEP_AFTER_MS) {
    mood = 'SLEEP'
    $.ui.invalidate('ui.render')
  }
  if (!spriteScale) return
  const k = spriteScale
  const cells = cellsOf(scaleGrid(pixels(mood, frame, { level: levelOf(xp), night: isNight() }), k))
  if (cells === lastCells) return
  lastCells = cells
  try {
    await $.ui.blit({ requestId: PANE, key: 'mascot', columns: WIDTH * k, rows: ROWS * k, cells })
  } catch {
    // Not mounted yet (desktop, or the pane is waiting for room)
  }
}

async function pollGit($) {
  if (busy || !repoRoot) return
  const before = JSON.stringify(git)
  await refreshBranch($)
  await refreshGitState($)
  if (JSON.stringify(git) !== before) $.ui.invalidate('ui.render')
}

async function fetchRemote($) {
  git = { ...git, fetching: true }
  $.ui.invalidate('ui.render')
  await git$($, ['fetch', '--quiet'], 30000)
  git = { ...git, fetching: false }
  await refreshGitState($)
  $.ui.invalidate('ui.render')
}

// Read .env files at the repo root and one level into apps/ and packages/
async function loadEnvSecrets($) {
  envSecrets = []
  if (!repoRoot) return
  const dirs = [repoRoot]
  for (const sub of ['apps', 'packages']) {
    try {
      const list = await $.fs.list(repoRoot + '/' + sub)
      for (const ent of list) if (ent.kind === 'directory') dirs.push(repoRoot + '/' + sub + '/' + ent.name)
    } catch {
      // No such folder
    }
  }
  const values = new Set()
  for (const dir of dirs) {
    let list = []
    try {
      list = await $.fs.list(dir)
    } catch {
      continue
    }
    for (const ent of list) {
      if (ent.kind !== 'file' || !isSecretHome(ent.name)) continue
      try {
        for (const v of envValues(await $.fs.read(dir + '/' + ent.name))) values.add(v)
      } catch {
        // Unreadable
      }
    }
  }
  envSecrets = [...values]
}

// The branch's PR and its checks, through the gh CLI
async function refreshCi($) {
  if (!repoRoot || !branch) {
    ci = { ...ci, pr: null, checks: [], error: '' }
    return
  }
  ci = { ...ci, loading: true }
  try {
    const view = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,state,reviewDecision,isDraft,url'], {
      cwd: repoRoot,
      timeoutMs: 15000,
    })
    if (view.exitCode !== 0) {
      const noPr = /no (open )?pull requests? found|no pull request/i.test(view.stderr)
      ci = { pr: null, checks: [], error: noPr ? '' : clip(view.stderr || 'gh failed', 60), loading: false, checkedAt: await $.clock.now() }
      return
    }
    const pr = JSON.parse(view.stdout)
    // gh exits non-zero while checks fail or pend, but still prints the JSON
    const chk = await $.process.run(['gh', 'pr', 'checks', '--json', 'name,bucket,workflow'], { cwd: repoRoot, timeoutMs: 15000 })
    let checks = []
    try {
      checks = JSON.parse(chk.stdout || '[]')
    } catch {
      checks = []
    }
    ci = { pr, checks, error: '', loading: false, checkedAt: await $.clock.now() }
  } catch (err) {
    ci = { ...ci, error: /ENOENT|not found|cannot start/i.test(String(err)) ? 'gh CLI not installed' : 'gh failed', loading: false }
  }
}

async function refreshPorts($) {
  try {
    if (isWindows) {
      const ns = await $.process.run(['netstat', '-ano', '-p', 'tcp'], { timeoutMs: 10000 })
      const tl = await $.process.run(['tasklist', '/fo', 'csv', '/nh'], { timeoutMs: 10000 })
      ports = parseWindowsPorts(ns.stdout, tl.stdout)
    } else {
      const ls = await $.process.run(['lsof', '-iTCP', '-sTCP:LISTEN', '-P', '-n'], { timeoutMs: 10000 })
      ports = parseLsofPorts(ls.stdout)
    }
  } catch {
    ports = []
  }
}

async function openUrl($, url) {
  try {
    if (isWindows) await $.process.run(['cmd', '/c', 'start', '', url])
    else await $.process.run(['open', url])
  } catch {
    try {
      await $.process.run(['xdg-open', url])
    } catch {
      $.ui.toast('[!] could not open ' + url)
    }
  }
}

async function pollCi($) {
  if (busy || !repoRoot) return
  const before = JSON.stringify([ci.pr, ci.checks, ci.error])
  await refreshCi($)
  if (JSON.stringify([ci.pr, ci.checks, ci.error]) !== before) $.ui.invalidate('ui.render')
}

async function pollPorts($) {
  if (!paneOpen) return
  const before = JSON.stringify(ports)
  await refreshPorts($)
  if (JSON.stringify(ports) !== before) $.ui.invalidate('ui.render')
}

// Play one of sounds/*.wav without waiting for it. Windows terminals have no
// player for $.audio, so PowerShell's SoundPlayer plays it there.
function play($, name) {
  if (muted || !interactive) return
  if (isWindows) {
    const path = ($.plugin.root + '/sounds/' + name + '.wav').replace(/\//g, '\\').replace(/'/g, "''")
    $.process
      .run(['powershell', '-NoProfile', '-NonInteractive', '-Command', "(New-Object Media.SoundPlayer '" + path + "').PlaySync()"], {
        timeoutMs: 10000,
      })
      .catch(() => {})
  } else {
    $.audio.play({ asset: 'sounds/' + name + '.wav' }).catch(() => {})
  }
}

async function loadProfile($) {
  try {
    xp = Number((await $.store.get('xp')) ?? 0) || 0
    muted = (await $.store.get('muted')) === true
  } catch {
    // No store yet
  }
}

// Add XP, reading the store first since other sessions add to it too.
// Resolves to the new level when this award crossed one, else 0.
async function awardXp($, amount) {
  try {
    const saved = Number((await $.store.get('xp')) ?? 0) || 0
    xp = saved + amount
    await $.store.set('xp', xp)
    const before = levelOf(saved)
    const after = levelOf(xp)
    return after > before ? after : 0
  } catch {
    return 0
  }
}

// Hold a tool call while the user decides; resolves true to let it run
async function confirm($, question, labels) {
  const before = mood
  play($, 'alert')
  await setMood($, 'ALERT')
  let answer = labels[1]
  try {
    answer = await $.ui.ask(question, labels)
  } catch {
    // Dismissed: treat as refused
  }
  await setMood($, before)
  return answer === labels[0]
}

async function openPane($) {
  paneOpen = true
  userClosed = false
  lastCells = ''
  try {
    const res = await $.ui.open({ id: PANE, title: 'rai//hud', columns: 60, rows: 24 })
    placed = !!(res && res.isPlaced)
  } catch {
    placed = false
  }
}

function cycleTab(step) {
  tab = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    isWindows = /^[A-Za-z]:[\\/]/.test(e.cwd || '')
    await refreshBranch($)
    await refreshGitState($)
    await loadEnvSecrets($)
    await loadProfile($)
    if (interactive) {
      $.ui.toast('[+] rai-hud online :: git-guard ARMED')
      lastActivity = await $.clock.now()
      $.clock.every(FRAME_MS, () => tick($))
      $.clock.every(GIT_POLL_MS, () => pollGit($))
      $.clock.every(CI_POLL_MS, () => pollCi($))
      $.clock.every(PORT_POLL_MS, () => pollPorts($))
      // First fill, without holding up the session start
      $.clock.after(500, () => pollCi($))
      $.clock.after(800, () => pollPorts($))
      // Opens by itself only in a wide terminal; /hud opens it anywhere
      await openPane($)
      try {
        await $.command.register({
          name: 'hud',
          description: 'Toggle the rai-hud sidebar, or jump to a tab',
          argumentHint: '[tasks|files|cmds|git|ci|ports|mute]',
          immediate: true,
        })
      } catch {
        // Name taken; the pane still auto-opens
      }
    }
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    // "/hud files" or "/hud 2": open the sidebar on that tab
    const arg = String(e.args || '').trim().toLowerCase()
    if (arg === 'mute' || arg === 'unmute') {
      muted = arg === 'mute' ? !muted : false
      try {
        await $.store.set('muted', muted)
      } catch {
        // Keep it for this session at least
      }
      $.ui.toast(muted ? '[-] rai-hud sounds off' : '[+] rai-hud sounds on')
      return {}
    }
    const pick = TABS.find((t, i) => arg && (t.startsWith(arg) || arg === String(i + 1)))
    if (pick) {
      tab = pick
      if (!paneOpen) await openPane($)
      $.ui.invalidate('ui.render')
      return {}
    }
    if (paneOpen && placed) {
      paneOpen = false
      placed = false
      userClosed = true
      await $.ui.close({ id: PANE })
    } else {
      await openPane($)
    }
    return {}
  })

  // The user closed the pane with its own controls
  on('ui.close', { id: PANE }, async ($, e, next) => {
    paneOpen = false
    placed = false
    if (e.origin && e.origin.kind === 'person') userClosed = true
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Your prompt counts as asking for the pane, so a sidebar still waiting for
  // a wide terminal gets placed now, at any width. Adds nothing to the prompt.
  on('prompt.submit', async ($, e, next) => {
    if (interactive && !userClosed && !placed) await openPane($)
    return next(e)
  })

  // Main-loop turns only: subagent runs raise no turn.start
  on('turn.start', async ($, e, next) => {
    busy = true
    toolCalls = 0
    turnFiles = new Set()
    target = ''
    await setMood($, 'THINKING')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    busy = false
    const u = e.usage
    last = {
      tools: toolCalls,
      files: turnFiles.size,
      tokens: u ? (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0,
      aborted: e.isAborted,
    }
    const failed = e.isAborted || e.reason === 'error'
    const leveled = failed || !interactive ? 0 : await awardXp($, xpForTurn(toolCalls, turnFiles.size))
    if (leveled) {
      await setMood($, 'LEVELUP', 6000)
      $.ui.toast('[+] LEVEL UP :: LVL ' + leveled + ' ' + titleOf(leveled), { timeoutMs: 6000 })
      play($, 'levelup')
    } else {
      await setMood($, failed ? 'STOPPED' : 'DONE', 6000)
      // Sound only for turns long enough that you may have looked away
      if (e.durationMs >= 15000) {
        if (!e.isAborted) play($, failed ? 'fail' : 'done')
      }
    }
    // Claude may have switched branches, committed, or changed files
    await refreshBranch($)
    await refreshGitState($)
    await refreshFiles($)
    $.ui.invalidate('ui.render')
    return result
  })

  // Every tool call: count it, set the mood, and record what it did
  on('tool.call', async ($, e, next) => {
    toolCalls += 1
    if (e.tool !== 'AskUserQuestion') {
      target = targetOf(e)
      await setMood($, moodForTool(e.tool))
    }
    const isShell = SHELL_TOOLS.includes(e.tool) && typeof e.command === 'string'
    let entry = null
    if (isShell) {
      entry = { at: await $.clock.now(), cmd: e.command, state: 'run' }
      cmds = [entry, ...cmds].slice(0, 8)
    }
    $.ui.invalidate('ui.render')

    const res = await next(e)

    const failed = !res || res.deny !== undefined || res.isError
    if (entry) {
      entry.state = res && res.deny !== undefined ? 'deny' : failed ? 'fail' : 'ok'
      if (/\bgit\b/.test(e.command)) {
        await refreshBranch($)
        await refreshGitState($)
      }
      if (/\b(git\s+push|gh\s+pr)\b/.test(e.command)) $.clock.after(5000, () => pollCi($))
    }
    if (EDIT_TOOLS.includes(e.tool) && e.file_path && !failed && isSecretHome(e.file_path)) await loadEnvSecrets($)
    if (EDIT_TOOLS.includes(e.tool) && e.file_path && !failed) {
      turnFiles.add(e.file_path)
      if (!files.has(e.file_path)) files.set(e.file_path, { add: 0, del: 0, isNew: false })
      await refreshFiles($)
    }
    if (TASK_TOOLS.includes(e.tool) && !failed) applyTaskCall(e, res.result)
    $.ui.invalidate('ui.render')
    return res
  })

  // Git guard: hold risky git commands until you authorize them
  on('tool.call', { tool: SHELL_TOOLS }, async ($, e, next) => {
    // Scripts and -p runs have nobody to ask, so they pass through untouched
    if (!interactive || typeof e.command !== 'string') return next(e)
    const risk = riskOf(e.command)
    if (!risk) return next(e)
    const ok = await confirm(
      $,
      '[!] GIT-GUARD :: ' + risk + ' intercepted >> `' + e.command.slice(0, 200) + '` :: authorize?',
      ['Authorize', 'Deny'],
    )
    if (!ok) {
      return { deny: 'The user blocked this git command (' + risk + ') via the git guard. Do not retry it; ask the user how to proceed.' }
    }
    return next(e)
  }).catch(async () => {
    return { deny: 'The git guard failed, so this command was not run. Ask the user to run it themselves.' }
  })

  // Secret guard: hold a write or command that would put a secret somewhere it shouldn't be.
  // File writes trip on known key formats and on your real .env values; shell
  // commands trip only on your real .env values, so ordinary commands stay quiet.
  on('tool.call', { tool: [...EDIT_TOOLS, ...SHELL_TOOLS] }, async ($, e, next) => {
    if (!interactive) return next(e)
    const isShell = SHELL_TOOLS.includes(e.tool)
    if (!isShell && isSecretHome(e.file_path || '')) return next(e)
    const text = isShell ? e.command : e.content || e.new_string || e.new_source || ''
    const hit = isShell ? findSecret(text, envSecrets) : findSecret(text, envSecrets)
    if (!hit || (isShell && hit.label !== 'value from your .env')) return next(e)
    const where = isShell ? 'a shell command' : baseName(e.file_path || 'a file')
    const ok = await confirm(
      $,
      '[!] SECRET-GUARD :: ' + hit.label + ' (' + mask(hit.match) + ') headed for ' + where + ' :: authorize?',
      ['Authorize', 'Deny'],
    )
    if (!ok) {
      return {
        deny:
          'The user blocked this ' + (isShell ? 'command' : 'write') + ' because it contains what looks like a secret (' + hit.label + '). ' +
          'Do not put the literal value in code or commands; read it from an environment variable instead, and ask the user if unsure.',
      }
    }
    return next(e)
  }).catch(async () => {
    return { deny: 'The secret guard failed, so this was not run. Ask the user how to proceed.' }
  })

  // Spinner: "Thinking ▸ exec:4 wr:1…" (Claude Code's spinner already shows time)
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!busy) return next(e)
    let suffix = ' ▸ exec:' + toolCalls
    if (turnFiles.size) suffix += ' wr:' + turnFiles.size
    return next({ ...e, props: { ...e.props, suffix: suffix + '…' } })
  })

  // The sidebar: mascot, readout, tabs, and the open tab's panel
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    placed = true
    const { Box, Text, Button, Raster, Svg } = $.ui.resolve(e)
    const props = e.props || {}
    const width = Math.max(20, props.bodyColumns || 40)
    const narrow = width < 46
    const color = MOOD_COLOR[mood] || 'green'
    const redraw = () => $.ui.invalidate('ui.render')
    const grid = pixels(mood, frame, { level: levelOf(xp), night: isNight() })

    // Size the mascot to the sidebar. Beside the transcript it scales to the
    // width (2x from 56 columns); above the prompt in a short terminal there's
    // no room for it, so a one-line face stands in.
    const windowRows = (e.viewport && e.viewport.rows) || 40
    const inline = props.placement === 'inline'
    if (e.surface !== 'terminal') spriteScale = 1
    else if (width < WIDTH || (inline && windowRows < 20)) spriteScale = 0
    else spriteScale = scaleFor(width, inline ? 1 : 3)
    while (spriteScale > 1 && ROWS * spriteScale > windowRows * 0.45) spriteScale -= 1
    const k = spriteScale
    let sprite = null
    if (e.surface !== 'terminal') {
      const px = Math.min(420, width * 8)
      sprite = Svg({ source: asSvg(grid), alt: 'rai-hud mascot: ' + mood, width: px, height: Math.round((px * 18) / 28) })
    } else if (k) {
      const pad = Math.max(0, Math.floor((width - WIDTH * k) / 2))
      sprite = Box({
        paddingLeft: pad,
        children: [Raster({ key: 'mascot', columns: WIDTH * k, rows: ROWS * k, cells: cellsOf(scaleGrid(grid, k)) })],
      })
    }

    const readout = [
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          ...(k ? [] : [Text({ color, bold: true, children: [face(mood)] })]),
          Text({ color, bold: true, children: ['[' + mood + ']'] }),
          Text({ color, wrap: 'truncate', children: ['> ' + MOOD_LINE[mood]] }),
        ],
      }),
    ]
    if (target && mood !== 'IDLE' && mood !== 'SLEEP') {
      readout.push(Text({ color: 'green', dimColor: true, wrap: 'truncate', children: ['tgt: ' + target] }))
    }
    const level = levelOf(xp)
    const floor = xpFor(level)
    const ceil = xpFor(level + 1)
    const barLen = Math.max(4, Math.min(16, width - 30))
    const filled = Math.round(((xp - floor) / (ceil - floor)) * barLen)
    readout.push(
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ color: 'yellow', bold: true, children: ['LVL ' + level] }),
          ...(width >= 34 ? [Text({ color: 'yellow', wrap: 'truncate', children: [titleOf(level)] })] : []),
          Text({ color: 'yellow', children: ['▰'.repeat(filled) + '▱'.repeat(barLen - filled)] }),
          Text({ dimColor: true, children: [xp + '/' + ceil + (muted ? ' 🔇' : '')] }),
        ],
      }),
    )
    if (isNight()) readout.push(Text({ color: 'red', bold: true, children: [nightLine()] }))

    // Tab bar, with a count on each tab
    const done = plan.filter((t) => t.status === 'completed').length
    const fails = cmds.filter((c) => c.state === 'fail').length
    const tabs = [
      ['tasks', '1', 'tasks' + (plan.length ? ' ' + done + '/' + plan.length : '')],
      ['files', '2', 'files' + (files.size ? ' ' + files.size : '')],
      ['cmds', '3', 'cmds' + (fails ? ' ✗' + fails : '')],
      ['git', '4', 'git' + (git.ahead ? ' ↑' + git.ahead : '')],
      ['ci', '5', 'ci' + ciBadge()],
      ['ports', '6', 'ports' + (ports.length ? ' ' + ports.length : '')],
    ]
    // ‹ and › borrow the /diff panel's Ctrl+Up / Ctrl+Down, which do nothing
    // while that panel is closed, so tabs switch straight from the prompt
    const arrow = (key, label, action, step) =>
      Button({
        key,
        label,
        action,
        plain: true,
        dimColor: true,
        onPress: () => {
          cycleTab(step)
          redraw()
        },
      })
    // Fit the tab row to the width: full labels, then short ones, then digits
    // with only the open tab named
    const SHORT = { tasks: 'tsk', files: 'fil', cmds: 'cmd', git: 'git', ci: 'ci', ports: 'prt' }
    const ICON = { tasks: '☐', files: '≡', cmds: '>', git: '⎇', ci: '✓', ports: '⇄' }
    // A plain button draws "1: label"; the arrows take a column each
    const rowLen = (ls, g) => 2 + ls.reduce((n, l) => n + l.length + 3, 0) + g * (ls.length + 1)
    const full = tabs.map((t) => t[2])
    const short = tabs.map(([id, , l]) => SHORT[id] + l.slice(id.length))
    const icons = tabs.map(([id], i) => (id === tab ? short[i] : ICON[id]))
    let labels = icons
    let gap = 1
    for (const [ls, g] of [[full, 2], [full, 1], [short, 2], [short, 1], [icons, 2], [icons, 1]]) {
      if (rowLen(ls, g) <= width) {
        labels = ls
        gap = g
        break
      }
    }
    const tabBar = Box({
      flexDirection: 'row',
      columnGap: gap,
      children: [arrow('tab-prev', '‹', 'app:diffFileListUp', -1)].concat(
        tabs.map(([id, key], i) => [id, key, labels[i]]).map(([id, key, label]) =>
        Button({
          key: 'tab-' + id,
          label,
          hotkey: key,
          plain: true,
          dimColor: tab !== id,
          onPress: () => {
            tab = id
            redraw()
          },
        }),
        ),
        [arrow('tab-next', '›', 'app:diffFileListDown', 1)],
      ),
    })

    const dim = (s) => Text({ dimColor: true, wrap: 'truncate', children: [s] })
    let body = []

    if (tab === 'tasks') {
      if (!plan.length) body = [dim('// no active plan')]
      else
        body = plan.slice(0, 14).map((t) =>
          Text({
            color: t.status === 'in_progress' ? 'yellow' : 'green',
            bold: t.status === 'in_progress',
            dimColor: t.status === 'completed',
            wrap: 'truncate',
            children: [(t.status === 'completed' ? '[x] ' : t.status === 'in_progress' ? '[>] ' : '[ ] ') + t.subject],
          }),
        )
      if (plan.length > 14) body.push(dim('  +' + (plan.length - 14) + ' more'))
    }

    if (tab === 'files') {
      if (!files.size) body = [dim('// no files changed yet')]
      else {
        let add = 0
        let del = 0
        const list = [...files.entries()]
        body = list.slice(0, 12).map(([p, s], i) => {
          add += s.add
          del += s.del
          const stat = s.isNew ? 'new' : s.add || s.del ? '' : '±0'
          return Box({
            key: 'file-' + i,
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Button({
                key: 'copy-' + i,
                label: '⧉',
                plain: true,
                onPress: async (pe) => {
                  await $.ui.copy({ text: p, surface: pe.surface })
                  $.ui.toast('[+] copied ' + baseName(p))
                },
              }),
              Text({ color: 'green', wrap: 'truncate-start', children: [clip(relPath(p), Math.max(8, width - (stat ? stat.length : String(s.add).length + String(s.del).length + 3) - 6))] }),
              stat
                ? Text({ color: s.isNew ? 'cyan' : 'gray', children: [stat] })
                : Box({
                    flexDirection: 'row',
                    columnGap: 1,
                    children: [
                      Text({ color: 'green', children: ['+' + s.add] }),
                      Text({ color: 'red', children: ['-' + s.del] }),
                    ],
                  }),
            ],
          })
        })
        if (list.length > 12) body.push(dim('  +' + (list.length - 12) + ' more'))
        body.push(dim('Σ ' + files.size + ' files  +' + add + ' -' + del + '  (⧉ copies path)'))
      }
    }

    if (tab === 'cmds') {
      if (!cmds.length) body = [dim('// no shell commands yet')]
      else
        body = cmds.map((c, i) => {
          const mark = { run: '…', ok: '✓', fail: '✗', deny: '⊘' }[c.state]
          const tone = { run: 'yellow', ok: 'green', fail: 'red', deny: 'red' }[c.state]
          return Box({
            key: 'cmd-' + i,
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Text({ color: tone, bold: true, children: [mark] }),
              ...(narrow ? [] : [Text({ dimColor: true, children: [clock(c.at)] })]),
              Text({ color: tone, wrap: 'truncate', children: [clip(c.cmd, Math.max(8, width - (narrow ? 4 : 14)))] }),
            ],
          })
        })
    }

    if (tab === 'git') {
      if (!repoRoot) body = [dim('// not a git repo')]
      else {
        const head = git.upstream
          ? Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Text({ color: git.ahead ? 'yellow' : 'green', bold: true, children: ['↑' + git.ahead] }),
                Text({ color: git.behind ? 'red' : 'green', bold: true, children: ['↓' + git.behind] }),
                Text({ dimColor: true, wrap: 'truncate', children: [git.upstream] }),
              ],
            })
          : Text({ color: 'yellow', children: ['[!] no upstream :: never pushed'] })
        body = [head]
        if (git.stash) body.push(Text({ color: 'cyan', children: ['stash: ' + git.stash] }))
        if (git.unpushed.length) {
          body.push(dim(git.upstream ? 'unpushed:' : 'local commits:'))
          git.unpushed.forEach((l, i) =>
            body.push(Text({ color: 'green', wrap: 'truncate', children: ['  ' + l] })),
          )
        } else if (git.upstream) {
          body.push(dim('// in sync with remote'))
        }
        body.push(
          Button({
            key: 'fetch',
            label: git.fetching ? 'fetching…' : 'fetch',
            hotkey: 'f',
            plain: true,
            onPress: () => fetchRemote($),
          }),
        )
      }
    }

    if (tab === 'ci') {
      if (!repoRoot) body = [dim('// not a git repo')]
      else if (ci.error) body = [Text({ color: 'red', wrap: 'truncate', children: ['[!] ' + ci.error] })]
      else if (!ci.pr) body = [dim(ci.checkedAt ? '// no PR for ' + branch : '// checking…')]
      else {
        const pr = ci.pr
        const review =
          { APPROVED: ['approved', 'green'], CHANGES_REQUESTED: ['changes requested', 'red'], REVIEW_REQUIRED: ['review pending', 'yellow'] }[
            pr.reviewDecision
          ] || ['no review', 'gray']
        body = [
          Text({ color: 'green', bold: true, wrap: 'truncate', children: ['#' + pr.number + ' ' + pr.title] }),
          Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Text({ color: pr.state === 'OPEN' ? 'green' : 'magenta', children: [(pr.isDraft ? 'draft' : pr.state.toLowerCase())] }),
              Text({ dimColor: true, children: ['·'] }),
              Text({ color: review[1], children: [review[0]] }),
            ],
          }),
        ]
        if (!ci.checks.length) body.push(dim('// no checks'))
        const order = { fail: 0, cancel: 1, pending: 2, pass: 3, skipping: 4 }
        const sorted = [...ci.checks].sort((a, b) => (order[a.bucket] ?? 5) - (order[b.bucket] ?? 5))
        for (const c of sorted.slice(0, 10)) {
          const mark = { pass: '✓', fail: '✗', pending: '…', cancel: '⊘', skipping: '-' }[c.bucket] || '?'
          const tone = { pass: 'green', fail: 'red', pending: 'yellow', cancel: 'red', skipping: 'gray' }[c.bucket] || 'gray'
          body.push(
            Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Text({ color: tone, bold: true, children: [mark] }),
                Text({ color: tone, wrap: 'truncate', children: [c.name] }),
              ],
            }),
          )
        }
        if (sorted.length > 10) body.push(dim('  +' + (sorted.length - 10) + ' more'))
        body.push(
          Box({
            flexDirection: 'row',
            columnGap: 2,
            children: [
              Button({ key: 'ci-open', label: 'open PR', hotkey: 'o', plain: true, onPress: () => openUrl($, pr.url) }),
              Button({
                key: 'ci-refresh',
                label: ci.loading ? 'checking…' : 'refresh',
                hotkey: 'r',
                plain: true,
                onPress: async () => {
                  await refreshCi($)
                  redraw()
                },
              }),
            ],
          }),
        )
      }
    }

    if (tab === 'ports') {
      if (!ports.length) body = [dim('// no dev servers listening')]
      else
        body = ports.slice(0, 12).map((pt, i) =>
          Box({
            key: 'port-' + i,
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Button({
                key: 'open-' + pt.port,
                label: '↗',
                plain: true,
                onPress: () => openUrl($, 'http://localhost:' + pt.port),
              }),
              Text({ color: 'green', bold: true, children: [':' + pt.port] }),
              Text({ color: 'cyan', wrap: 'truncate', children: [pt.name] }),
              Text({ dimColor: true, wrap: 'truncate', children: [portHint(pt.port)] }),
            ],
          }),
        )
      body.push(dim('↗ opens in browser · refreshes every 20s'))
    }

    return Box({
      flexDirection: 'column',
      children: [
        ...(sprite ? [sprite] : []),
        ...readout,
        Text({ dimColor: true, children: ['─'.repeat(width)] }),
        tabBar,
        ...body,
        Text({
          dimColor: true,
          wrap: 'truncate',
          children: [width >= 46 ? 'ctrl+↑↓ tabs · /hud <tab> · ctrl+x tab focus' : 'ctrl+↑↓ tabs · /hud <tab>'],
        }),
      ],
    })
  })

  // Band above the prompt: "rai@hud:~$ last_op ▸ exec:6 wr:2 rx:18.2k [OK]"
  // Empty until the first turn ends
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const night = isNight()
    // While the sidebar isn't on screen, the mascot rides in the band instead
    const mini = interactive && !placed && !userClosed
    if (!last && !night && !mini) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (mini) {
      const c = MOOD_COLOR[mood] || 'green'
      const parts = [
        Text({ color: c, bold: true, children: [face(mood)] }),
        Text({ color: c, bold: true, children: ['[' + mood + ']'] }),
        Text({ color: c, wrap: 'truncate', children: [MOOD_LINE[mood]] }),
        Text({ color: 'yellow', children: ['LVL ' + levelOf(xp)] }),
      ]
      if (night) parts.push(Text({ color: 'red', bold: true, children: [nightLine()] }))
      if (!last) parts.push(Text({ dimColor: true, wrap: 'truncate', children: ['· sidebar opens on your first prompt'] }))
      const rows = [Box({ flexDirection: 'row', columnGap: 1, children: parts })]
      if (last) rows.push(bandRow(Box, Text))
      const rest = await next(e)
      if (rest) rows.push(rest)
      return rows.length === 1 ? rows[0] : Box({ flexDirection: 'column', children: rows })
    }
    if (!last) {
      const rest = await next(e)
      const warn = Text({ color: 'red', bold: true, children: [nightLine()] })
      return rest ? Box({ flexDirection: 'column', children: [warn, rest] }) : warn
    }
    const row = bandRow(Box, Text, night)
    // Keep anything other mods draw in the band
    const rest = await next(e)
    return rest ? Box({ flexDirection: 'column', children: [row, rest] }) : row
  })
}

// The band's last-turn row: "rai@hud:~$ last_op ▸ exec:6 wr:2 rx:18.2k [OK]"
function bandRow(Box, Text, night) {
  const stats = ['exec:' + last.tools]
  if (last.files) stats.push('wr:' + last.files)
  if (last.tokens) stats.push('rx:' + fmtTokens(last.tokens))
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Text({ color: 'green', bold: true, children: ['rai@hud:~$'] }),
      Text({ color: 'green', dimColor: true, children: ['last_op ▸'] }),
      Text({ color: 'green', wrap: 'truncate', children: [stats.join(' ')] }),
      last.aborted
        ? Text({ color: 'red', bold: true, children: ['[SIGINT]'] })
        : Text({ color: 'green', bold: true, children: ['[OK]'] }),
    ].concat(night ? [Text({ color: 'red', bold: true, children: [nightLine()] })] : []),
  })
}
