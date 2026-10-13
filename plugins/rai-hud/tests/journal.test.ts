import { expect, mock, test } from 'claude-code/testing'
import { dayOf, formatSection, upsertSection, logPath, parseNote, prevDay, summaryOf, aboutIn } from '../hooks/journal.js'

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
      '## 14:32–15:10 · [[rai-mods]] (main) · 38m',
      '- 6 turns · 41 tools · +212 XP → LVL 4',
      '- files (2, +134 -14): `hooks/register.js` +120 -14, `hooks/journal.js` new',
      '- shell: 18 run, 2 failed',
      '- guards: push ✓ allowed, secret ⊘ denied',
      '<!-- /rai -->',
    ].join('\n'),
  )
})

test('memory notes become links, listed first so the cap keeps them', () => {
  const files = [
    ...Array.from({ length: 11 }, (_, i) => ['f' + i + '.ts', { add: 1, del: 0, isNew: false }]),
    ['~/…/x/memory/project_one_piece.md', { add: 0, del: 0, isNew: false }],
    ['~/…/x/memory/MEMORY.md', { add: 0, del: 0, isNew: false }],
  ]
  const text = formatSection({ ...DATA, files })
  expect(text).toContain('- files (13, +11 -0): [[project_one_piece]] edited, `f0.ts` +1 -0')
  expect(text).not.toContain('[[MEMORY]]')
})

test('the first prompt becomes a one-line "about", safe for the note', () => {
  expect(summaryOf('  fix the\n\nlogin   redirect ')).toBe('fix the login redirect')
  expect(summaryOf('/clear')).toBe('')
  expect(summaryOf('link [[x]] <!-- /rai -->')).toBe('link [x]  /rai ')
  const long = summaryOf('a'.repeat(150))
  expect(long.length).toBe(100)
  expect(long.endsWith('…')).toBe(true)
  expect(formatSection({ ...DATA, summary: 'fix login' })).toContain('38m\n- about: fix login\n- 6 turns')
  expect(summaryOf('the <pasted_content id="a1">\nlong\nlog\n</pasted_content id="a1"> fix it')).toBe('the [pasted] fix it')
})

test('a resumed session keeps the "about" it started with', () => {
  const note = upsertSection('', 'abc', formatSection({ ...DATA, summary: 'first ask' }), 'd') + formatSection({ ...DATA, id: 'def', summary: 'other' })
  expect(aboutIn(note, 'abc')).toBe('first ask')
  expect(aboutIn(note, 'def')).toBe('other')
  expect(aboutIn(note, 'zzz')).toBe('')
  expect(aboutIn(upsertSection('', 'abc', formatSection(DATA), 'd'), 'abc')).toBe('')
})

test('names Obsidian cannot link, and no repo, stay plain text', () => {
  expect(formatSection({ ...DATA, project: 'c#-lab', branch: '' })).toContain('## 14:32–15:10 · c#-lab · 38m')
  expect(formatSection({ ...DATA, project: '', branch: '' })).toContain('## 14:32–15:10 · no repo · 38m')
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

test('a new note links back to the previous day, skipping gaps and other files', () => {
  const names = ['2026-10-01.md', '2026-10-04.md', 'Journal.md', '2026-10-06.md', '2026-10-04.md.bak']
  expect(prevDay(names, '2026-10-06')).toBe('2026-10-04')
  expect(prevDay(names, '2026-10-01')).toBe('')
  const a = formatSection(DATA)
  expect(upsertSection('', 'abc', a, '2026-10-06', '2026-10-04')).toBe('# 2026-10-06\n\n← [[2026-10-04]]\n\n' + a + '\n')
  // An existing note keeps its header untouched
  const b = formatSection({ ...DATA, id: 'def' })
  expect(upsertSection('# x\n\n' + a + '\n', 'def', b, '2026-10-06', '2026-10-04')).toBe('# x\n\n' + a + '\n\n' + b + '\n')
})

test('files outside the repo log as ~/… with "edited", not a full path and +0 -0', () => {
  const home = 'C:\\Users\\rai'
  expect(logPath('C:/work/src/a.ts', 'C:/work', home)).toBe('src/a.ts')
  expect(logPath('C:\\Users\\rai\\.claude\\CLAUDE.md', 'C:/work', home)).toBe('~/.claude/CLAUDE.md')
  expect(logPath('C:/Users/rai/.claude/projects/x/memory/MEMORY.md', 'C:/work', home)).toBe('~/…/x/memory/MEMORY.md')
  const text = formatSection({ ...DATA, files: [['~/.claude/CLAUDE.md', { add: 0, del: 0, isNew: false }]] })
  expect(text).toContain('`~/.claude/CLAUDE.md` edited')
})

test('a daily note parses back into its sessions', () => {
  const note = upsertSection(upsertSection('', 'abc', formatSection(DATA), 'd'), 'def', formatSection({ ...DATA, id: 'def', project: 'raigon', branch: '', turns: 1, xp: 0, files: [] }), 'd')
  expect(parseNote(note)).toEqual([
    { id: 'abc', time: '14:32–15:10', project: 'rai-mods (main)', span: '38m', turns: 6, xp: 212, files: 2 },
    { id: 'def', time: '14:32–15:10', project: 'raigon', span: '38m', turns: 1, xp: 0, files: 0 },
  ])
  // Windows line endings, as git may leave them
  expect(parseNote(note.replace(/\n/g, '\r\n'))).toHaveLength(2)
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

async function turn($, id: string, text = 'go') {
  await $.turn.start({ text, turnId: id })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ turnId: id, answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer', usage: null })
}

test("each turn rewrites this session's section in the daily note", async ($, on) => {
  const { files } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1', 'use key sk-ant-api03-' + 'x'.repeat(90))
  await turn($, 't2', 'fix the login redirect')
  await turn($, 't3', 'and the logout one')
  expect(files.size).toBe(1)
  // The first prompt without a secret, and only that one
  expect([...files.values()][0]).toContain('- about: fix the login redirect\n')
  expect([...files.values()][0]).not.toContain('sk-ant')
  const [path, text] = [...files.entries()][0]
  // The day comes from the mock clock; the harness may hand back backslashes
  expect(path).toMatch(/^C:[\\/]vault[\\/]Journal[\\/]\d{4}-\d{2}-\d{2}\.md$/)
  expect(text.match(/<!-- rai:sess-1 -->/g)).toHaveLength(1)
  expect(text).toContain('- 3 turns · 3 tools')
  expect(text).toContain('- shell: 3 run')
})

const PANE = {
  plugin: 'rai-hud',
  component: 'Pane',
  requestId: 'rai-hud',
  surface: 'terminal',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'rai//hud', isFocused: false, bodyColumns: 62, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the today tab lists this session and the others in the note', async ($, on) => {
  const { files } = setup(on)
  // Another session already logged today (the mock clock's day)
  files.set('C:\\vault\\Journal\\' + dayOf(0) + '.md',upsertSection('', 'other', formatSection({ ...DATA, id: 'other', project: 'raigon', branch: '' }), dayOf(0)))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1')
  await $.command.run({ command: 'hud', args: 'today' })
  const ui = await $.ui.mount(PANE as any)
  expect(await ui.find({ type: 'Text', text: '· 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'raigon' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▸' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '    1 turn' })).toBeDefined()
})

test('the today tab says how to turn the journal on', async ($, on) => {
  setup(on, { journalDir: '' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await $.command.run({ command: 'hud', args: 'today' })
  const ui = await $.ui.mount(PANE as any)
  expect(await ui.find({ type: 'Text', text: '// journal off · /hud journal <dir> to log sessions' })).toBeDefined()
})

test('with no journal dir set, nothing is written', async ($, on) => {
  const { files } = setup(on, { journalDir: '' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1')
  expect(files.size).toBe(0)
})
