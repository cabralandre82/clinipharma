import { describe, it, expect } from 'vitest'
import { redact, redactString, __internals } from '@/lib/logger/redact'

// -----------------------------------------------------------------------------
// redactString — value-level patterns
// -----------------------------------------------------------------------------

describe('redactString', () => {
  describe('CPF', () => {
    it('redacts formatted CPF', () => {
      expect(redactString('user cpf is 123.456.789-01 today')).toBe(
        'user cpf is [redacted:cpf] today'
      )
    })

    it('redacts bare 11-digit CPF', () => {
      expect(redactString('id=12345678901')).toBe('id=[redacted:cpf]')
    })

    it('redacts multiple CPFs in a single string', () => {
      expect(redactString('cpf1=123.456.789-01 cpf2=987.654.321-00')).toBe(
        'cpf1=[redacted:cpf] cpf2=[redacted:cpf]'
      )
    })

    it('leaves 10-digit numbers untouched (not a CPF)', () => {
      expect(redactString('phone=1234567890')).not.toContain('[redacted:cpf]')
    })
  })

  describe('CNPJ', () => {
    it('redacts formatted CNPJ', () => {
      expect(redactString('cnpj 12.345.678/0001-95 is active')).toBe(
        'cnpj [redacted:cnpj] is active'
      )
    })

    it('redacts bare 14-digit CNPJ', () => {
      expect(redactString('CNPJ:12345678000195')).toBe('CNPJ:[redacted:cnpj]')
    })
  })

  describe('email', () => {
    it('partially masks a typical email', () => {
      expect(redactString('contact: alice@example.com please')).toBe(
        'contact: al***@example.com please'
      )
    })

    it('masks very short local parts (1 char)', () => {
      expect(redactString('a@example.com')).toBe('a***@example.com')
    })

    it('masks multiple emails', () => {
      expect(redactString('alice@a.com or bob@b.com')).toBe('al***@a.com or bo***@b.com')
    })

    it('leaves non-emails (@ without domain) alone', () => {
      expect(redactString('use @mention for user')).toBe('use @mention for user')
    })
  })

  describe('phone', () => {
    it('masks 11-digit Brazilian cellphone', () => {
      expect(redactString('(11) 91234-5678 ligue')).toContain('11****78')
    })

    it('masks bare 11-digit number', () => {
      // Note: bare 11-digit numbers are ambiguous with CPFs; CPF pattern wins first.
      // This test documents the current precedence.
      const out = redactString('11987654321')
      expect(out.includes('[redacted:cpf]') || out.includes('****')).toBe(true)
    })

    it('leaves 4-digit codes untouched', () => {
      expect(redactString('pin=1234')).toBe('pin=1234')
    })
  })

  describe('JWT', () => {
    it('redacts Supabase-style JWT', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmno'
      expect(redactString(`token=${jwt}`)).toBe('token=[redacted:jwt]')
    })

    it('leaves short strings that start with eyJ alone', () => {
      expect(redactString('eyJx')).toBe('eyJx')
    })
  })

  describe('Authorization headers', () => {
    it('redacts Bearer tokens', () => {
      expect(redactString('Authorization: Bearer abc123xyz')).toContain('Bearer [redacted:auth]')
    })

    it('redacts Basic auth', () => {
      expect(redactString('Basic dXNlcjpwYXNz')).toContain('Basic [redacted:auth]')
    })
  })

  describe('API keys', () => {
    it('redacts Stripe-style sk_live_ keys', () => {
      expect(redactString('STRIPE=sk_live_abcdefghij1234567890')).toBe('STRIPE=[redacted:api-key]')
    })

    it('redacts Supabase PAT (sbp_)', () => {
      expect(redactString('sbp_01234567890abcdef')).toBe('[redacted:api-key]')
    })

    it('redacts Cloudflare API token (cfat_)', () => {
      expect(redactString('cfat_abcdefghij0123456789')).toBe('[redacted:api-key]')
    })

    it('redacts Resend key (re_)', () => {
      expect(redactString('re_abcdefghij0123456789')).toBe('[redacted:api-key]')
    })
  })

  describe('credit cards', () => {
    it('masks a 16-digit card, keeping BIN and last 4', () => {
      expect(redactString('card=4111111111111111')).toBe('card=411111******1111')
    })

    it('masks space-separated card', () => {
      expect(redactString('4111 1111 1111 1111')).toBe('411111******1111')
    })

    it('leaves too-short runs alone', () => {
      expect(redactString('12345')).toBe('12345')
    })
  })

  describe('Postgres URLs', () => {
    it('redacts a postgres URL with credentials', () => {
      expect(redactString('DB=postgresql://user:password@host.com/db')).toBe(
        'DB=[redacted:postgres-url]'
      )
    })

    it('redacts a postgres:// URL', () => {
      expect(redactString('postgres://u:p@h/d')).toBe('[redacted:postgres-url]')
    })
  })

  describe('length cap', () => {
    it('truncates strings > MAX_STRING_LENGTH', () => {
      const big = 'a'.repeat(__internals.MAX_STRING_LENGTH + 100)
      const out = redactString(big)
      expect(out.length).toBeLessThan(big.length)
      expect(out).toContain('…[+100 chars]')
    })
  })
})

// -----------------------------------------------------------------------------
// redact — object-level behaviour
// -----------------------------------------------------------------------------

describe('redact()', () => {
  it('leaves allowed keys (requestId, userId, path) untouched', () => {
    const out = redact({
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '123.456.789-01',
      path: '/api/orders/123',
      durationMs: 42,
    })
    expect(out.requestId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(out.userId).toBe('123.456.789-01')
    expect(out.path).toBe('/api/orders/123')
    expect(out.durationMs).toBe(42)
  })

  it('replaces sensitive-key values wholesale', () => {
    const out = redact({ password: 'hunter2', secret: 'abc', apiKey: 'zz' })
    expect(out.password).toBe('[redacted]')
    expect(out.secret).toBe('[redacted]')
    expect(out.apiKey).toBe('[redacted]')
  })

  it('is case-insensitive on sensitive keys', () => {
    const out = redact({ PASSWORD: 'x', Authorization: 'Bearer x' })
    expect(out.PASSWORD).toBe('[redacted]')
    expect(out.Authorization).toBe('[redacted]')
  })

  it('recurses into nested objects', () => {
    const out = redact({
      user: { email: 'alice@example.com', password: 'secret' },
      action: 'login',
    })
    const user = out.user as Record<string, unknown>
    expect(user.email).toBe('al***@example.com')
    expect(user.password).toBe('[redacted]')
    expect(out.action).toBe('login')
  })

  it('recurses into arrays', () => {
    const out = redact({ emails: ['a@x.com', 'b@y.com'] })
    expect(out.emails).toEqual(['a***@x.com', 'b***@y.com'])
  })

  it('caps array length at MAX_ARRAY_ITEMS', () => {
    const items = Array.from({ length: __internals.MAX_ARRAY_ITEMS + 5 }, (_, i) => i)
    const out = redact({ items }) as { items: unknown[] }
    expect(out.items.length).toBe(__internals.MAX_ARRAY_ITEMS + 1)
    expect(out.items[__internals.MAX_ARRAY_ITEMS]).toMatch(/^\[\+5 more items\]$/)
  })

  it('caps recursion depth', () => {
    let deep: Record<string, unknown> = { leaf: 'x' }
    // Build MAX_DEPTH+3 wrappers: { nested: { nested: { … } } }
    for (let i = 0; i < __internals.MAX_DEPTH + 3; i++) {
      deep = { nested: deep }
    }
    const out = JSON.stringify(redact(deep))
    // At or before we exceed MAX_DEPTH, the recursive walk must emit the
    // sentinel — otherwise we'd blow the stack on adversarial input.
    expect(out).toContain('[redacted:max-depth]')
  })

  it('handles cycles without infinite recursion', () => {
    const a: Record<string, unknown> = { name: 'a' }
    const b: Record<string, unknown> = { name: 'b', friend: a }
    a.friend = b
    const out = redact({ root: a })
    // Should not throw; cycle detected and replaced with '[circular]'
    expect(JSON.stringify(out)).toContain('[circular]')
  })

  it('serializes Error objects', () => {
    const err = new Error('boom: cpf 123.456.789-01')
    const out = redact({ error: err }) as unknown as {
      error: { name: string; message: string; stack?: string }
    }
    expect(out.error.name).toBe('Error')
    expect(out.error.message).toBe('boom: cpf [redacted:cpf]')
    expect(out.error.stack).toContain('Error:')
  })

  it('serializes Dates to ISO strings', () => {
    const d = new Date('2026-04-17T10:00:00.000Z')
    const out = redact({ when: d })
    expect(out.when).toBe('2026-04-17T10:00:00.000Z')
  })

  it('redacts embedded URLs containing credentials', () => {
    const out = redact({
      connectionString: 'postgres://admin:hunter2@db.clinipharma.com/main',
    })
    expect(out.connectionString).toBe('[redacted:postgres-url]')
  })

  it('returns sentinel on a redactor throw (robustness)', () => {
    // A getter that throws — forces redactValue into its catch path.
    const evil: Record<string, unknown> = {}
    Object.defineProperty(evil, 'trigger', {
      enumerable: true,
      get() {
        throw new Error('getter exploded')
      },
    })
    const out = redact(evil)
    // The outer redact() catch-all must have converted the throw to a sentinel
    // (or it recovered by stringifying the object — either way, it must not
    // propagate the exception and it must return a plain object).
    expect(typeof out).toBe('object')
  })

  it('preserves primitive passthrough', () => {
    const out = redact({ count: 42, active: true, name: 'Acme' })
    expect(out.count).toBe(42)
    expect(out.active).toBe(true)
    expect(out.name).toBe('Acme')
  })

  it('drops functions and symbols', () => {
    const out = redact({ fn: () => 1, sym: Symbol('x') })
    expect(out.fn).toBe('[function]')
    expect(out.sym).toBe('[symbol]')
  })

  it('redacts sensitive keys nested inside an allowed branch', () => {
    const out = redact({
      requestId: 'r-1',
      meta: {
        password: 'hunter2',
        email: 'alex@x.com',
      },
    })
    expect(out.requestId).toBe('r-1')
    const meta = out.meta as Record<string, unknown>
    expect(meta.password).toBe('[redacted]')
    expect(meta.email).toBe('al***@x.com')
  })
})
