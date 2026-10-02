// Pure helpers for restyling Claude Code's own interface: the tool tags, the
// hacker verbs, and the formatting the transcript rows use. No mods API here.

export function clip(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

export function baseName(p) {
  return String(p).split(/[\\/]/).pop()
}

// Path relative to `root`, with forward slashes; matching ignores case (Windows)
export function relPathOf(abs, root) {
  const norm = String(abs).replace(/\\/g, '/')
  const r = String(root || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  return r && norm.toLowerCase().startsWith(r.toLowerCase() + '/') ? norm.slice(r.length + 1) : norm
}

// ── Tool tags ──────────────────────────────────────────────────────────────

// [tag, color] for a tool. Tags are four characters so the rows line up.
export function tagFor(tool) {
  const t = String(tool || '')
  if (t === 'Read') return ['READ', 'cyan']
  if (t === 'Edit' || t === 'NotebookEdit') return ['EDIT', 'green']
  if (t === 'Write') return ['WRIT', 'green']
  if (t === 'Bash' || t === 'PowerShell') return ['EXEC', 'yellow']
  if (t === 'Grep') return ['GREP', 'cyan']
  if (t === 'Glob') return ['GLOB', 'cyan']
  if (t === 'WebFetch' || t === 'WebSearch') return ['NET ', 'magenta']
  if (t === 'Agent') return ['SPWN', 'magenta']
  if (t === 'TaskCreate' || t === 'TaskUpdate' || t === 'TodoWrite' || t === 'TaskList' || t === 'TaskGet') return ['PLAN', 'green']
  if (t === 'Skill') return ['SKIL', 'green']
  if (t.startsWith('mcp__')) return ['MCP ', 'magenta']
  return ['TOOL', 'gray']
}

// "server:tool" from "mcp__server__tool"
export function mcpName(tool) {
  const parts = String(tool).split('__')
  return parts.length >= 3 ? parts[1] + ':' + parts.slice(2).join('__') : String(tool)
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return String(url)
  }
}

// What a tool call is about, as one short string
export function targetFor(tool, input, root) {
  const i = input || {}
  const t = String(tool || '')
  if (i.file_path || i.notebook_path) return relPathOf(i.file_path || i.notebook_path, root)
  if (t === 'Bash' || t === 'PowerShell') return String(i.command || '')
  if (t === 'Grep' || t === 'Glob') return String(i.pattern || '') + (i.path ? ' in ' + relPathOf(i.path, root) : '')
  if (t === 'WebFetch') return hostOf(i.url || '')
  if (t === 'WebSearch') return String(i.query || '')
  if (t === 'Agent') return String(i.description || i.subagent_type || '')
  if (t === 'TaskCreate') return String(i.subject || '')
  if (t === 'TaskUpdate') return '#' + (i.taskId || '?') + (i.status ? ' ' + i.status : '')
  if (t === 'TodoWrite') return (Array.isArray(i.todos) ? i.todos.length : 0) + ' items'
  if (t === 'Skill') return String(i.skill || i.name || '')
  if (t.startsWith('mcp__')) return mcpName(t)
  return t
}

// Lines added and removed in a structuredPatch
export function patchCounts(patch) {
  let add = 0
  let del = 0
  for (const hunk of patch || []) {
    for (const line of hunk.lines || []) {
      if (line.startsWith('+')) add += 1
      else if (line.startsWith('-')) del += 1
    }
  }
  return { add, del }
}

// A short detail from a finished call's output, or '' when there's none
export function detailFor(tool, output) {
  const o = output && typeof output === 'object' ? output : null
  if (!o) return ''
  if (tool === 'Read' && o.file && typeof o.file.numLines === 'number') return o.file.numLines + ' lines'
  if (tool === 'Write' && o.type === 'create') return 'new'
  if ((tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') && Array.isArray(o.structuredPatch)) {
    const { add, del } = patchCounts(o.structuredPatch)
    return '+' + add + ' -' + del
  }
  if ((tool === 'Grep' || tool === 'Glob') && typeof o.numFiles === 'number') return o.numFiles + (o.numFiles === 1 ? ' file' : ' files')
  return ''
}

// [mark, color] for a call's state
export function statusFor(p) {
  if (p.isInterrupted) return ['⊘ SIGINT', 'red']
  if (p.isErrored) return ['✗', 'red']
  if (p.isRunning) return ['…', 'yellow']
  return ['✓', 'green']
}

// "3 reads · 2 greps · 1 glob" for a folded group of calls
export function groupSummary(calls) {
  const names = { Read: 'read', Grep: 'grep', Glob: 'glob', Bash: 'cmd', PowerShell: 'cmd', WebFetch: 'fetch', WebSearch: 'search' }
  const counts = new Map()
  for (const c of calls || []) {
    const n = names[c.tool] || 'call'
    counts.set(n, (counts.get(n) || 0) + 1)
  }
  return [...counts.entries()].map(([n, k]) => k + ' ' + n + (k === 1 ? '' : 's')).join(' · ')
}

// ── Words ──────────────────────────────────────────────────────────────────

const VERBS = {
  THINKING: ['Decrypting', 'Brute-forcing', 'Handshaking', 'Compiling payload'],
  SCANNING: ['Scanning', 'Tracing', 'Enumerating', 'Sniffing'],
  EDITING: ['Injecting', 'Patching', 'Rewriting'],
  EXEC: ['Executing', 'Escalating', 'Spawning shell'],
  SPAWNING: ['Forking', 'Deploying agent'],
  NET: ['Exfiltrating', 'Pinging', 'Tunneling'],
  WORKING: ['Hacking', 'Processing'],
}

// A hacker verb for a mood. `seed` (the turn number) keeps one turn's word steady.
export function verbFor(mood, seed) {
  const list = VERBS[mood] || VERBS.THINKING
  return list[Math.abs(seed | 0) % list.length]
}

// "41s", "1m04s"
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'
}

// The turn-end line's parts: [label, color, text]
export function turnSummary(record, durationMs) {
  let label = ['[OK]', 'green', 'op complete']
  if (record && record.aborted) label = ['[SIGINT]', 'red', 'op aborted']
  else if (record && record.error) label = ['[ERR]', 'red', 'op failed']
  const stats = [fmtDuration(durationMs)]
  if (record) {
    stats.push('exec:' + record.tools)
    if (record.files) stats.push('wr:' + record.files)
    if (record.xpGain) stats.push('+' + record.xpGain + ' XP')
  }
  return { label: label[0], color: label[1], text: label[2] + ' :: ' + stats.join(' · ') }
}
