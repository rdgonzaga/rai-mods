// Pure helpers: secret detection and listening-port parsing. No mods API here.

// Secret patterns: [label, regex]. Ordered most specific first.
const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['DB URL with password', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/'"]+:(?!password@|pass@|\*+@|\$\{?)[^@\s'"]{4,}@/i],
  [
    'hardcoded secret',
    /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\b["']?\s*[:=]\s*["'](?![^"']*(?:\$\{|process\.env|your[_-]|example|changeme|xxx|<))[^"'\s]{16,}["']/i,
  ],
]

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return atob(part + '='.repeat((4 - (part.length % 4)) % 4))
  } catch {
    return ''
  }
}

// Mask a secret for display: first 4 and last 4 characters
export function mask(s) {
  s = String(s)
  return s.length <= 10 ? '****' : s.slice(0, 4) + '…' + s.slice(-4)
}

// Files where writing a secret is expected (gitignored env files), not a leak
export function isSecretHome(path) {
  const name = String(path).split(/[\\/]/).pop().toLowerCase()
  return /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template|dist)$/.test(name)
}

// Find the first secret in `text`. `known` is a list of real secret values
// (from the repo's .env files) to catch verbatim. Returns { label, match } or null.
export function findSecret(text, known) {
  if (!text) return null
  text = String(text)
  for (const value of known || []) {
    if (value && text.includes(value)) return { label: 'value from your .env', match: value }
  }
  for (const [label, re] of SECRET_PATTERNS) {
    const m = text.match(re)
    if (m) return { label, match: m[0] }
  }
  for (const m of text.matchAll(JWT)) {
    const payload = decodeJwtPayload(m[0])
    if (/service_role/.test(payload)) return { label: 'Supabase service-role key', match: m[0] }
  }
  return null
}

// Values worth guarding from a .env file's text: long, non-placeholder values
export function envValues(text) {
  const out = []
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/)
    if (!m) continue
    const v = m[1].trim().replace(/^(['"])(.*)\1$/, '$2')
    if (v.length < 12 || /^(true|false|null|undefined|localhost)$/i.test(v)) continue
    if (/^https?:\/\/[^@]*$/.test(v)) continue // plain URLs without credentials
    out.push(v)
  }
  return out
}

// Processes that listen on ports but aren't dev servers (Windows)
const NOISE = /^(system|svchost|lsass|wininit|services|spoolsv|searchhost|explorer|msedge|chrome|steam|discord|spotify|onedrive|teams|slack|zoom|nvcontainer|nvidia.*|razer.*|dropbox|code|cursor|claude|idea64|jetbrains.*|mdnsresponder|rapportd|controlcenter|sharingd|airplayxpcHelper|nahimic.*|medal|esrv.*|githubdesktop|github desktop|lghub.*|corsair.*|epicgames.*|obs64|nordvpn.*|adobe.*|ccxprocess)(\.exe)?$/i

// Runtimes worth showing even on high (ephemeral-range) ports
const DEV = /^(node|bun|deno|python\d*|java|ruby|php|go|dotnet|postgres|mysqld|redis-server|mongod|docker.*|com\.docker.*|vite|esbuild|uvicorn|gunicorn|wsl.*|vmmem.*)(\.exe)?$/i

// Parse `netstat -ano -p tcp` + `tasklist /fo csv /nh` (Windows)
export function parseWindowsPorts(netstat, tasklist) {
  const names = new Map()
  for (const line of String(tasklist).split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/)
    if (m) names.set(m[2], m[1])
  }
  const seen = new Map()
  for (const line of String(netstat).split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i)
    if (!m) continue
    const port = Number(m[2])
    const name = (names.get(m[3]) || 'pid ' + m[3]).replace(/\.exe$/i, '')
    if (port < 1024 || NOISE.test(name) || seen.has(port)) continue
    if (port >= 49152 && !DEV.test(name)) continue
    seen.set(port, { port, name, pid: Number(m[3]) })
  }
  return [...seen.values()].sort((a, b) => a.port - b.port)
}

// Parse `lsof -iTCP -sTCP:LISTEN -P -n` (macOS / Linux)
export function parseLsofPorts(lsof) {
  const seen = new Map()
  for (const line of String(lsof).split(/\r?\n/).slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 9) continue
    const m = cols[8].match(/:(\d+)$/)
    if (!m) continue
    const port = Number(m[1])
    if (port < 1024 || NOISE.test(cols[0]) || seen.has(port)) continue
    if (port >= 49152 && !DEV.test(cols[0])) continue
    seen.set(port, { port, name: cols[0], pid: Number(cols[1]) })
  }
  return [...seen.values()].sort((a, b) => a.port - b.port)
}

// A friendly label for common dev ports
export function portHint(port) {
  return (
    {
      3000: 'web',
      3001: 'web',
      4000: 'api',
      5173: 'vite',
      5432: 'postgres',
      6379: 'redis',
      8000: 'api',
      8080: 'http',
      8081: 'expo/metro',
      19000: 'expo',
      19006: 'expo web',
      54321: 'supabase',
      54322: 'supabase db',
      54323: 'supabase studio',
    }[port] || ''
  )
}
