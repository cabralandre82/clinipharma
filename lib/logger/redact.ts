/**
 * PII redactor for the structured logger.
 *
 * Goal: never ship CPF, CNPJ, emails, phone numbers, JWTs, bearer tokens,
 * Supabase service-role keys, passwords, cookies, or payment card fragments
 * to stdout (→ Vercel logs) or to the `server_logs` table (→ admins in the UI).
 *
 * Design principles:
 *
 *  1. **Never throw.** A bug in the redactor must not crash a request. The
 *     top-level `redact()` catches everything and falls back to the literal
 *     string `"[redactor-failed]"` — loud enough to notice, silent enough
 *     to keep the system running.
 *
 *  2. **Whitelist structure, redact values.** We descend into arrays and
 *     plain objects and redact:
 *       a) keys that match a sensitive-key pattern (replace value wholesale)
 *       b) string values that match a sensitive-value pattern (mask in place)
 *
 *  3. **Bounded.** Depth capped at 8, string length capped at 4096 chars,
 *     arrays capped at 100 items. Anything larger is truncated with a
 *     marker so operators see the shape without drowning in data.
 *
 *  4. **Deterministic.** No reliance on clocks, random, or external IO.
 *     Pure function of input → output, unit-testable.
 *
 *  5. **Cycle-safe.** Uses a WeakSet of visited objects to detect cycles
 *     (e.g. Next.js `Request` objects with circular `.request` refs).
 *
 * What we DO NOT redact:
 *   - Short strings (< 4 chars) that can't carry PII
 *   - Booleans, numbers, null, undefined — let them through verbatim
 *   - Keys in the ALLOWED_KEYS set (requestId, userId, durationMs…)
 *
 * Tuning: to weaken/strengthen, prefer adding keys to SENSITIVE_KEYS or
 * patterns to SENSITIVE_VALUE_PATTERNS over changing the public API.
 */

const MAX_DEPTH = 8
const MAX_STRING_LENGTH = 4096
const MAX_ARRAY_ITEMS = 100

/**
 * Regex for Brazilian CPF (11 digits, optionally formatted `123.456.789-01`).
 * Matches both bare and formatted variants; excludes runs >14 digits to avoid
 * false positives on IDs/timestamps.
 */
const CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g

/**
 * Brazilian CNPJ (14 digits, formatted `12.345.678/0001-95` or bare).
 * Must not match a sequence of 15+ digits (IDs, serial numbers).
 */
const CNPJ_REGEX = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g

/**
 * RFC 5322 email (practical subset). The tail of the match after `@` may
 * be partial — enough to be recognisably an email in a log line.
 */
const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g

/**
 * Brazilian phone in common formats:
 *   (11) 91234-5678  |  11912345678  |  +55 11 91234-5678
 * Cellular and landline, 10–13 digits counting country code.
 */
const PHONE_REGEX = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g

/**
 * JSON Web Token — three dot-delimited base64url segments.
 * Catches Supabase access tokens, service-role keys, refresh tokens.
 */
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g

/**
 * HTTP Authorization header values (Bearer <jwt>, Basic base64,…).
 * Matches from `Bearer ` up to the next whitespace / quote / comma.
 */
const BEARER_REGEX = /\b(Bearer|Basic|token)\s+[^\s"',]+/gi

/**
 * Credit card (Luhn-length runs of 13–19 digits, optionally space/dash
 * separated in groups of 4). Conservative: we keep BIN + last 4 visible.
 */
const CARD_REGEX = /\b(?:\d[ -]?){12,18}\d\b/g

/**
 * Supabase/Postgres URLs embedded with credentials:
 *   postgresql://user:secret@host/db
 *   https://xxx.supabase.co (with service key in other fields)
 */
const POSTGRES_URL_REGEX = /\b(?:postgres(?:ql)?):\/\/[^\s"'@]+:[^\s"'@]+@[^\s"']+/g

/**
 * Stripe/Asaas-style secret key prefixes.
 *   sk_live_..., pk_live_..., cfat_..., sbp_..., re_..., whsec_...
 *
 * Each alternative carries its own `_` suffix so we don't double it with the
 * literal `_` that used to follow the alternation (Resend tokens use a
 * single underscore, not two).
 */
const API_KEY_REGEX =
  /\b(?:sk_live_|sk_test_|pk_live_|pk_test_|sbp_|cfat_|cfk_|xkeysib_|re_|whsec_)[A-Za-z0-9]{10,}/g

/**
 * Keys whose VALUE is always secret, regardless of format. Case-insensitive
 * exact match against object keys. Keep this list short and opinionated —
 * it's the strongest redaction lever we have.
 */
const SENSITIVE_KEYS = new Set<string>(
  [
    'password',
    'password_hash',
    'passwordHash',
    'currentPassword',
    'newPassword',
    'token',
    'access_token',
    'accessToken',
    'refresh_token',
    'refreshToken',
    'id_token',
    'idToken',
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'apikey',
    'api_key',
    'apiKey',
    'secret',
    'client_secret',
    'clientSecret',
    'webhook_secret',
    'webhookSecret',
    'signing_key',
    'signingKey',
    'service_role_key',
    'serviceRoleKey',
    'age_private_key',
    'agePrivateKey',
    'private_key',
    'privateKey',
    'ssn',
    'cpf',
    'cnpj',
    'rg',
    'passport',
    'birth_date',
    'birthDate',
    'birthdate',
    'full_name', // prescriber/patient names leaked in error contexts
    'patient_name',
    'patientName',
    'mother_name',
    'motherName',
    'card_number',
    'cardNumber',
    'cvv',
    'ccv',
  ].map((k) => k.toLowerCase())
)

/**
 * Keys that are always safe to emit verbatim — used as a short-circuit so the
 * regex suite doesn't accidentally redact useful debug info (e.g. a requestId
 * whose value happens to look like a 14-digit run).
 */
const ALLOWED_KEYS = new Set<string>(
  [
    'requestId',
    'request_id',
    'traceId',
    'trace_id',
    'spanId',
    'span_id',
    'parentSpanId',
    'parent_span_id',
    'userId',
    'user_id',
    'tenantId',
    'tenant_id',
    'clinicId',
    'clinic_id',
    'pharmacyId',
    'pharmacy_id',
    'orderId',
    'order_id',
    'level',
    'message',
    'timestamp',
    'env',
    'durationMs',
    'duration_ms',
    'statusCode',
    'status_code',
    'path',
    'method',
    'action',
    'entityType',
    'entity_type',
    'entityId',
    'entity_id',
    // Note: errorName / errorCode are safe (technical identifiers),
    // but errorMessage and errorStack must NOT be here — stack traces
    // and thrown messages regularly leak PII (customer CPFs, auth tokens
    // embedded in request payloads, etc). Those are redacted as normal
    // strings instead.
    'errorName',
    'errorRaw',
    'errorCode',
  ].map((k) => k.toLowerCase())
)

/**
 * Redact a string in place, replacing matches of sensitive patterns with
 * obvious placeholders. Order matters: JWT/API-key patterns run first
 * because their regexes are narrower and less likely to false-positive.
 */
export function redactString(value: string): string {
  if (value.length === 0) return value
  // Hard cap: truncate runaway strings before regex to bound CPU.
  const bounded =
    value.length > MAX_STRING_LENGTH
      ? value.slice(0, MAX_STRING_LENGTH) + `…[+${value.length - MAX_STRING_LENGTH} chars]`
      : value
  return bounded
    .replace(POSTGRES_URL_REGEX, '[redacted:postgres-url]')
    .replace(JWT_REGEX, '[redacted:jwt]')
    .replace(API_KEY_REGEX, '[redacted:api-key]')
    .replace(BEARER_REGEX, (m) => `${m.split(/\s+/)[0]} [redacted:auth]`)
    .replace(CNPJ_REGEX, '[redacted:cnpj]')
    .replace(CPF_REGEX, '[redacted:cpf]')
    .replace(CARD_REGEX, (match) => {
      const digits = match.replace(/\D/g, '')
      if (digits.length < 13 || digits.length > 19) return match
      return `${digits.slice(0, 6)}******${digits.slice(-4)}`
    })
    .replace(EMAIL_REGEX, (match) => {
      const [local, domain] = match.split('@')
      if (!local || !domain) return '[redacted:email]'
      const visible = local.length <= 2 ? (local[0] ?? '') : local.slice(0, 2)
      return `${visible}***@${domain}`
    })
    .replace(PHONE_REGEX, (match) => {
      const digits = match.replace(/\D/g, '')
      if (digits.length < 10 || digits.length > 13) return match
      return `${digits.slice(0, 2)}****${digits.slice(-2)}`
    })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return '[redacted:max-depth]'

  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string') return redactString(value as string)
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value

  // Functions, symbols — drop them, logs shouldn't carry those.
  if (t === 'function' || t === 'symbol') return `[${t}]`

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const limited = value.length > MAX_ARRAY_ITEMS ? value.slice(0, MAX_ARRAY_ITEMS) : value
    const result = limited.map((item) => redactValue(item, depth + 1, seen))
    if (value.length > MAX_ARRAY_ITEMS) {
      result.push(`[+${value.length - MAX_ARRAY_ITEMS} more items]`)
    }
    return result
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    }
  }

  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return redactString(value.toString())

  if (isPlainObject(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      const lowered = key.toLowerCase()
      if (SENSITIVE_KEYS.has(lowered)) {
        out[key] = '[redacted]'
        continue
      }
      if (ALLOWED_KEYS.has(lowered)) {
        // Pass-through without regex-redaction. Still recurses for nested
        // structures so a nested sensitive key is still caught.
        out[key] =
          typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
            ? v
            : redactValue(v, depth + 1, seen)
        continue
      }
      out[key] = redactValue(v, depth + 1, seen)
    }
    return out
  }

  // Non-plain objects (e.g. Request, Headers, Map…) — stringify defensively.
  try {
    const s = String(value)
    return redactString(s)
  } catch {
    return '[unstringifiable]'
  }
}

/**
 * Top-level redactor. Given an arbitrary log-context object, returns a new
 * object with PII masked. Never throws — errors fall through to a loud
 * sentinel so we notice without blowing up the request.
 *
 * @example
 *   redact({ email: 'user@example.com', ok: true })
 *   → { email: 'us***@example.com', ok: true }
 */
export function redact<T extends Record<string, unknown>>(ctx: T): T {
  try {
    return redactValue(ctx, 0, new WeakSet()) as T
  } catch {
    return { '[redactor-failed]': true } as unknown as T
  }
}

/**
 * Exposed for tests only — don't rely on these internals elsewhere.
 */
export const __internals = {
  CPF_REGEX,
  CNPJ_REGEX,
  EMAIL_REGEX,
  PHONE_REGEX,
  JWT_REGEX,
  BEARER_REGEX,
  CARD_REGEX,
  POSTGRES_URL_REGEX,
  API_KEY_REGEX,
  SENSITIVE_KEYS,
  ALLOWED_KEYS,
  MAX_DEPTH,
  MAX_STRING_LENGTH,
  MAX_ARRAY_ITEMS,
}
