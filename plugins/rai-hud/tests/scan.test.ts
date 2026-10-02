import { expect, test } from 'claude-code/testing'
import { findSecret, envValues, isSecretHome, mask, parseWindowsPorts, parseLsofPorts } from '../hooks/scan.js'

// Built at runtime so this file never holds a literal secret
const fake = {
  aws: 'AKIA' + 'Q'.repeat(16),
  gh: 'ghp_' + 'a1B2'.repeat(9),
  ant: 'sk-ant-' + 'x9'.repeat(20),
  google: 'AIza' + 'b'.repeat(35),
  pg: 'postgres://app:' + 'hunter2hunter2' + '@db.example.com:5432/app',
  jwt:
    'eyJhbGciOiJIUzI1NiJ9.' +
    btoa(JSON.stringify({ role: 'service_role', iss: 'supabase' })).replace(/=+$/, '') +
    '.c2lnbmF0dXJlc2lnbmF0dXJl',
  anonJwt: 'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '') + '.c2lnbmF0dXJlc2lnbmF0dXJl',
}

test('findSecret catches common key formats', () => {
  expect(findSecret('const k = "' + fake.aws + '"', [])?.label).toBe('AWS access key')
  expect(findSecret('token: ' + fake.gh, [])?.label).toBe('GitHub token')
  expect(findSecret('ANTHROPIC=' + fake.ant, [])?.label).toBe('Anthropic key')
  expect(findSecret('key=' + fake.google, [])?.label).toBe('Google API key')
  expect(findSecret('url = "' + fake.pg + '"', [])?.label).toBe('DB URL with password')
  expect(findSecret('const sb = "' + fake.jwt + '"', [])?.label).toBe('Supabase service-role key')
})

test('findSecret ignores placeholders, env reads, and the public anon key', () => {
  expect(findSecret('const key = process.env.API_KEY', [])).toBe(null)
  expect(findSecret('api_key: "your-api-key-goes-here-123"', [])).toBe(null)
  expect(findSecret('postgres://user:password@localhost/db', [])).toBe(null)
  expect(findSecret('const anon = "' + fake.anonJwt + '"', [])).toBe(null)
  expect(findSecret('function sketchy() { return 1 }', [])).toBe(null)
})

test('findSecret catches real .env values verbatim', () => {
  const known = envValues('DATABASE_URL="postgres://x:y@h/db"\nRESEND_API_KEY=rk_9f8e7d6c5b4a3f2e\nDEBUG=true\nPORT=3000')
  expect(known).toContain('rk_9f8e7d6c5b4a3f2e')
  expect(known).not.toContain('true')
  expect(findSecret('curl -H "Authorization: rk_9f8e7d6c5b4a3f2e"', known)?.label).toBe('value from your .env')
})

test('env files are where secrets belong, examples are not', () => {
  expect(isSecretHome('/repo/.env')).toBe(true)
  expect(isSecretHome('C:\\repo\\apps\\web\\.env.local')).toBe(true)
  expect(isSecretHome('/repo/.env.example')).toBe(false)
  expect(isSecretHome('/repo/src/env.ts')).toBe(false)
  expect(mask('abcdefghijklmnop')).toBe('abcd…mnop')
})

test('parseWindowsPorts keeps dev servers and drops system noise', () => {
  const netstat = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1200',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4242',
    '  TCP    [::]:3000              [::]:0                 LISTENING       4242',
    '  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       777',
    '  TCP    0.0.0.0:49664          0.0.0.0:0              LISTENING       900',
    '  TCP    127.0.0.1:3000         127.0.0.1:51000        ESTABLISHED     4242',
  ].join('\r\n')
  const tasklist = ['"svchost.exe","1200","Services","0","10,000 K"', '"node.exe","4242","Console","1","90,000 K"', '"postgres.exe","777","Services","0","20,000 K"', '"lsass.exe","900","Services","0","9,000 K"'].join('\r\n')
  expect(parseWindowsPorts(netstat, tasklist)).toEqual([
    { port: 3000, name: 'node', pid: 4242 },
    { port: 5432, name: 'postgres', pid: 777 },
  ])
})

test('parseLsofPorts reads lsof output', () => {
  const lsof = [
    'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'node    12345 rai   23u  IPv6 0xabc      0t0  TCP *:5173 (LISTEN)',
    'node    12345 rai   24u  IPv4 0xabd      0t0  TCP 127.0.0.1:5173 (LISTEN)',
  ].join('\n')
  expect(parseLsofPorts(lsof)).toEqual([{ port: 5173, name: 'node', pid: 12345 }])
})
