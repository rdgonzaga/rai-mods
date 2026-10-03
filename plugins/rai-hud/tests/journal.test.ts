import { expect, mock, test } from 'claude-code/testing'
import { dayOf, formatSection, upsertSection } from '../hooks/journal.js'

// ── journal.js units ───────────────────────────────────────────────────────

const at = (h: number, m: number) => new Date(2026, 9, 3, h, m).getTime()

const DATA = {
  id: 'abc',
  startedAt: at(14, 32),
  endedAt: at(15, 10),
  project: 'rai-mods',
  branch: 'main',
  turns: 6,
  tools: 41,
  xp: 212,
  level: 4,
  files: [
    ['hooks/register.js', { add: 120, del: 14, isNew: false }],
    ['hooks/journal.js', { add: 14, del: 0, isNew: true }],
  ],
  cmds: 18,
  cmdFails: 2,
  guards: [{ kind: 'push', outcome: 'allowed' }, { kind: 'secret', outcome: 'denied' }],
}

test('a session section lists turns, files, shell and guards', () => {
  expect(dayOf(at(14, 32))).toBe('2026-10-03')
  expect(formatSection(DATA)).toBe(
    [
      '<!-- rai:abc -->',
      '## 14:32–15:10 · rai-mods (main) · 38m',
      '- 6 turns · 41 tools · +212 XP → LVL 4',
      '- files (2, +134 -14): `hooks/register.js` +120 -14, `hooks/journal.js` new',
      '- shell: 18 run, 2 failed',
      '- guards: push ✓ allowed, secret ⊘ denied',
      '<!-- /rai -->',
    ].join('\n'),
  )
})

test('quiet sessions skip the empty lines, and long file lists are capped', () => {
  const files = Array.from({ length: 12 }, (_, i) => ['f' + i + '.ts', { add: 1, del: 0, isNew: false }])
  const text = formatSection({ ...DATA, xp: 0, files, cmds: 0, cmdFails: 0, guards: [], turns: 1 })
  expect(text).toContain('- 1 turn · 41 tools\n')
  expect(text).toContain('+2 more')
  expect(text).not.toContain('shell:')
  expect(text).not.toContain('guards:')
})

test('upsert starts a note, appends new sessions, and replaces its own', () => {
  const a1 = formatSection(DATA)
  const fresh = upsertSection('', 'abc', a1, '2026-10-03')
  expect(fresh).toBe('# 2026-10-03\n\n' + a1 + '\n')
  const b = formatSection({ ...DATA, id: 'def' })
  const two = upsertSection(fresh, 'def', b, '2026-10-03')
  expect(two).toBe('# 2026-10-03\n\n' + a1 + '\n\n' + b + '\n')
  const a2 = formatSection({ ...DATA, turns: 7 })
  expect(upsertSection(two, 'abc', a2, '2026-10-03')).toBe('# 2026-10-03\n\n' + a2 + '\n\n' + b + '\n')
})

// ── Wired into the session ─────────────────────────────────────────────────

function setup(on, { journalDir = 'C:/vault/Journal' } = {}) {
  mock.clock(on)
  const files = new Map<string, string>()
  const store = new Map<string, unknown>([['journalDir', journalDir]])
  on('session.start', () => ({ cwd: 'C:\\work' }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  for (const n of ['ui.toast', 'ui.blit', 'ui.close', 'command.register']) on(n, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ran' }))
  return { files }
}

async function turn($, id: string) {
  await $.turn.start({ text: 'go', turnId: id })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ turnId: id, answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer', usage: null })
}

test("each turn rewrites this session's section in the daily note", async ($, on) => {
  const { files } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1')
  await turn($, 't2')
  expect(files.size).toBe(1)
  const [path, text] = [...files.entries()][0]
  // The day comes from the mock clock; the harness may hand back backslashes
  expect(path).toMatch(/^C:[\\/]vault[\\/]Journal[\\/]\d{4}-\d{2}-\d{2}\.md$/)
  expect(text.match(/<!-- rai:sess-1 -->/g)).toHaveLength(1)
  expect(text).toContain('- 2 turns · 2 tools')
  expect(text).toContain('- shell: 2 run')
})

test('with no journal dir set, nothing is written', async ($, on) => {
  const { files } = setup(on, { journalDir: '' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1')
  expect(files.size).toBe(0)
})
