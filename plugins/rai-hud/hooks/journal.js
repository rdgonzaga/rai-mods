// The session journal: one markdown section per session in a daily note.
// Pure helpers; register.js does the reading and writing. No mods API here.

const pad = (n) => String(n).padStart(2, '0')

// "2026-10-03", in local time
export function dayOf(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function hhmm(ms) {
  const d = new Date(ms)
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

// "38m", "2h05m"
function span(ms) {
  const m = Math.max(1, Math.round(ms / 60000))
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + pad(m % 60) + 'm'
}

const GUARD_MARK = { allowed: '✓ allowed', denied: '⊘ denied' }

// "new", "+12 -3", or "edited" when git has no counts (outside the repo)
function fileStat(s) {
  if (s.isNew) return 'new'
  return s.add || s.del ? '+' + s.add + ' -' + s.del : 'edited'
}

// A Claude memory note's name ("project_x" for …/memory/project_x.md), which
// the vault mirror keeps, so it can be a link. '' for anything else, and for
// MEMORY.md, which every project has.
function memoryNote(path) {
  const m = /\/memory\/([^/]+)\.md$/i.exec(String(path).replace(/\\/g, '/'))
  return m && m[1].toUpperCase() !== 'MEMORY' && !/[[\]|#^]/.test(m[1]) ? m[1] : ''
}

// A prompt as one line for the journal: whitespace collapsed, capped, and
// with nothing that would turn into a link or end the section. '' for slash
// commands and empty prompts.
export function summaryOf(text) {
  const s = String(text || '')
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '[pasted]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s.startsWith('/')) return ''
  const safe = s.replace(/\[\[|\]\]/g, (b) => b[0]).replace(/<!--|-->/g, '')
  return safe.length > 100 ? safe.slice(0, 99).trimEnd() + '…' : safe
}

// A file's name for the log: repo-relative inside the repo, else ~/… and
// at most its last three parts
export function logPath(abs, root, home) {
  const norm = String(abs).replace(/\\/g, '/')
  const r = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (r && norm.toLowerCase().startsWith(r.toLowerCase() + '/')) return norm.slice(r.length + 1)
  const h = String(home || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const underHome = h && norm.toLowerCase().startsWith(h.toLowerCase() + '/')
  const parts = (underHome ? norm.slice(h.length + 1) : norm).split('/')
  const tail = parts.length > 3 ? '…/' + parts.slice(-3).join('/') : parts.join('/')
  return (underHome ? '~/' : '') + tail
}

// The sessions in a daily note, in order:
// [{ id, time, project, span, turns, files, xp }]
export function parseNote(text) {
  const out = []
  const re = /<!-- rai:(\S+) -->\r?\n([\s\S]*?)\r?\n<!-- \/rai -->/g
  let m
  while ((m = re.exec(String(text || '')))) {
    const lines = m[2].split(/\r?\n/)
    const head = (lines.find((l) => l.startsWith('## ')) || '').slice(3).split(' · ')
    const stats = lines.find((l) => /^- \d+ turns? /.test(l)) || ''
    const filesLine = lines.find((l) => l.startsWith('- files (')) || ''
    out.push({
      id: m[1],
      time: head[0] || '',
      project: (head[1] || '').replace(/^\[\[([^\]]*)\]\]/, '$1'),
      span: head[2] || '',
      turns: Number((stats.match(/^- (\d+) turn/) || [])[1] || 0),
      xp: Number((stats.match(/\+(\d+) XP/) || [])[1] || 0),
      files: Number((filesLine.match(/^- files \((\d+)/) || [])[1] || 0),
    })
  }
  return out
}

// A session's totals with this run's added onto its earlier runs' (base, or
// null for a fresh session). Counts add up and the earliest start wins. A
// file's +/- comes from git and already covers earlier runs, so the newer
// stats replace the older ones.
export function addTotals(base, cur) {
  if (!base) return cur
  const files = new Map(base.files || [])
  for (const [p, s] of cur.files) files.set(p, s)
  return {
    startedAt: Math.min(base.startedAt, cur.startedAt),
    summary: base.summary || cur.summary,
    turns: base.turns + cur.turns,
    tools: base.tools + cur.tools,
    xp: base.xp + cur.xp,
    files: [...files],
    cmds: base.cmds + cur.cmds,
    cmdFails: base.cmdFails + cur.cmdFails,
    guards: [...(base.guards || []), ...cur.guards],
  }
}

// The "about" line a session already has in the note, so a resumed session
// keeps what it started on. '' when there's none.
export function aboutIn(text, id) {
  const start = String(text || '').indexOf('<!-- rai:' + id + ' -->')
  if (start < 0) return ''
  const end = text.indexOf('<!-- /rai -->', start)
  const m = /\n- about: ([^\r\n]*)/.exec(text.slice(start, end < 0 ? undefined : end))
  return m ? m[1] : ''
}

// The markdown for one session, between its markers.
// data: { id, startedAt, endedAt, project, branch, summary, turns, tools, xp, level,
//         files: [[path, { add, del, isNew }]], cmds, cmdFails, guards: [{ kind, outcome }] }
export function formatSection(data) {
  // The project as an Obsidian link, so a note named or aliased after the repo
  // ties the day to it; names Obsidian can't link stay plain
  const p = data.project
  const project = !p ? 'no repo' : /[[\]|#^]/.test(p) ? p : '[[' + p + ']]'
  const head =
    '## ' + hhmm(data.startedAt) + '–' + hhmm(data.endedAt) + ' · ' + project +
    (data.branch ? ' (' + data.branch + ')' : '') + ' · ' + span(data.endedAt - data.startedAt)
  const lines = [head]
  if (data.summary) lines.push('- about: ' + data.summary)
  let stats = data.turns + (data.turns === 1 ? ' turn' : ' turns') + ' · ' + data.tools + ' tools'
  if (data.xp) stats += ' · +' + data.xp + ' XP → LVL ' + data.level
  lines.push('- ' + stats)
  const files = data.files || []
  if (files.length) {
    let add = 0
    let del = 0
    for (const [, s] of files) {
      add += s.add
      del += s.del
    }
    // Memory notes first, as links, so the cap never hides them
    const notes = files.filter(([p]) => memoryNote(p))
    const rest = files.filter(([p]) => !memoryNote(p))
    const shown = [...notes, ...rest]
      .slice(0, 10)
      .map(([p, s]) => (memoryNote(p) ? '[[' + memoryNote(p) + ']]' : '`' + p + '`') + ' ' + fileStat(s))
    if (files.length > 10) shown.push('+' + (files.length - 10) + ' more')
    lines.push('- files (' + files.length + ', +' + add + ' -' + del + '): ' + shown.join(', '))
  }
  if (data.cmds) lines.push('- shell: ' + data.cmds + ' run' + (data.cmdFails ? ', ' + data.cmdFails + ' failed' : ''))
  if (data.guards && data.guards.length) {
    lines.push('- guards: ' + data.guards.map((g) => g.kind + ' ' + (GUARD_MARK[g.outcome] || g.outcome)).join(', '))
  }
  return '<!-- rai:' + data.id + ' -->\n' + lines.join('\n') + '\n<!-- /rai -->'
}

// The latest daily note before this day, from the journal folder's file names,
// or '' when this is the first
export function prevDay(names, day) {
  let best = ''
  for (const n of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(n)
    if (m && m[1] < day && m[1] > best) best = m[1]
  }
  return best
}

// The daily note with this session's section replaced, or appended when it's
// new. An empty note gets a "# YYYY-MM-DD" header first, and a link back to
// the previous note so the days chain together in Obsidian's graph.
export function upsertSection(text, id, section, day, prev = '') {
  const open = '<!-- rai:' + id + ' -->'
  const start = text.indexOf(open)
  if (start >= 0) {
    const close = text.indexOf('<!-- /rai -->', start)
    if (close >= 0) return text.slice(0, start) + section + text.slice(close + '<!-- /rai -->'.length)
  }
  const base = text.trim()
    ? text.replace(/\s*$/, '\n\n')
    : '# ' + day + '\n\n' + (prev ? '← [[' + prev + ']]\n\n' : '')
  return base + section + '\n'
}
