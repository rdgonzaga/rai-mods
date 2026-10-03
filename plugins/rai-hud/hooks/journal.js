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

// The markdown for one session, between its markers.
// data: { id, startedAt, endedAt, project, branch, turns, tools, xp, level,
//         files: [[path, { add, del, isNew }]], cmds, cmdFails, guards: [{ kind, outcome }] }
export function formatSection(data) {
  const head =
    '## ' + hhmm(data.startedAt) + '–' + hhmm(data.endedAt) + ' · ' + (data.project || 'no repo') +
    (data.branch ? ' (' + data.branch + ')' : '') + ' · ' + span(data.endedAt - data.startedAt)
  const lines = [head]
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
    const shown = files.slice(0, 10).map(([p, s]) => '`' + p + '` ' + (s.isNew ? 'new' : '+' + s.add + ' -' + s.del))
    if (files.length > 10) shown.push('+' + (files.length - 10) + ' more')
    lines.push('- files (' + files.length + ', +' + add + ' -' + del + '): ' + shown.join(', '))
  }
  if (data.cmds) lines.push('- shell: ' + data.cmds + ' run' + (data.cmdFails ? ', ' + data.cmdFails + ' failed' : ''))
  if (data.guards && data.guards.length) {
    lines.push('- guards: ' + data.guards.map((g) => g.kind + ' ' + (GUARD_MARK[g.outcome] || g.outcome)).join(', '))
  }
  return '<!-- rai:' + data.id + ' -->\n' + lines.join('\n') + '\n<!-- /rai -->'
}

// The daily note with this session's section replaced, or appended when it's
// new. An empty note gets a "# YYYY-MM-DD" header first.
export function upsertSection(text, id, section, day) {
  const open = '<!-- rai:' + id + ' -->'
  const start = text.indexOf(open)
  if (start >= 0) {
    const close = text.indexOf('<!-- /rai -->', start)
    if (close >= 0) return text.slice(0, start) + section + text.slice(close + '<!-- /rai -->'.length)
  }
  const base = text.trim() ? text.replace(/\s*$/, '\n\n') : '# ' + day + '\n\n'
  return base + section + '\n'
}
