import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** Pull the parsed JSON log entry from a console spy call. */
function parseLastLog(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const calls = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls
  const last = calls[calls.length - 1]?.[0] as string
  return JSON.parse(last)
}

describe('logger — structural output', () => {
  it('logs JSON with level, message and timestamp', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('test message')

    expect(console.log).toHaveBeenCalledOnce()
    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('test message')
    expect(parsed.timestamp).toBeTruthy()
    expect(parsed.env).toBeTruthy()
  })

  it('logger.warn uses console.warn', async () => {
    const { logger } = await import('@/lib/logger')
    logger.warn('something might be wrong')
    expect(console.warn).toHaveBeenCalledOnce()
    expect(parseLastLog(console.warn as ReturnType<typeof vi.spyOn>).level).toBe('warn')
  })

  it('logger.error uses console.error and serializes Error objects', async () => {
    const { logger } = await import('@/lib/logger')
    const err = new Error('test error')
    logger.error('something failed', { error: err })

    expect(console.error).toHaveBeenCalledOnce()
    const parsed = parseLastLog(console.error as ReturnType<typeof vi.spyOn>)
    expect(parsed.level).toBe('error')
    expect(parsed.errorMessage).toBe('test error')
    expect(parsed.errorName).toBe('Error')
    expect(parsed.errorStack).toContain('Error: test error')
  })

  it('logger.error handles non-Error objects', async () => {
    const { logger } = await import('@/lib/logger')
    logger.error('db failed', { error: { code: '23505', message: 'unique constraint' } })

    const parsed = parseLastLog(console.error as ReturnType<typeof vi.spyOn>)
    expect(parsed.level).toBe('error')
    expect(parsed.errorRaw ?? parsed.errorMessage).toBeTruthy()
  })

  it('includes extra context fields in the log entry', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('order created', {
      requestId: 'req-123',
      userId: 'user-abc',
      action: 'CREATE_ORDER',
      durationMs: 450,
    })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.requestId).toBe('req-123')
    expect(parsed.userId).toBe('user-abc')
    expect(parsed.action).toBe('CREATE_ORDER')
    expect(parsed.durationMs).toBe(450)
  })

  it('logger.debug does not call console.debug in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { logger } = await import('@/lib/logger')
    logger.debug('verbose detail')
    expect(console.debug).not.toHaveBeenCalled()
  })
})

describe('logger — PII redaction (Wave 1)', () => {
  it('redacts emails in free-text message context', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('contact', { extra: 'email user@example.com failed' })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.extra).toContain('us***@example.com')
    expect(parsed.extra).not.toContain('user@example.com')
  })

  it('redacts CPFs in arbitrary context fields', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('cpf check', { rawPayload: 'cpf=123.456.789-01' })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.rawPayload).toContain('[redacted:cpf]')
  })

  it('wholesale-redacts a field named "password"', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('login', { password: 'hunter2' })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.password).toBe('[redacted]')
  })

  it('does NOT redact allowed keys like requestId / userId / path', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('req', {
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'auth0|12345',
      path: '/api/orders/123',
    })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.requestId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(parsed.userId).toBe('auth0|12345')
    expect(parsed.path).toBe('/api/orders/123')
  })

  it('redacts a JWT embedded in an error message', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij0123456789'
    const { logger } = await import('@/lib/logger')
    logger.error('auth fail', { error: new Error(`token=${jwt} invalid`) })

    const parsed = parseLastLog(console.error as ReturnType<typeof vi.spyOn>)
    expect(parsed.errorMessage).toBe('token=[redacted:jwt] invalid')
  })
})

describe('logger — AsyncLocalStorage auto-enrichment (Wave 1)', () => {
  it('auto-enriches with the ambient requestId', async () => {
    const { logger } = await import('@/lib/logger')
    const { runWithRequestContext, makeRequestContext } = await import('@/lib/logger/context')

    await runWithRequestContext(
      makeRequestContext({ requestId: 'als-req-1', userId: 'u-1', path: '/api/x' }),
      () => {
        logger.info('operation')
      }
    )

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.requestId).toBe('als-req-1')
    expect(parsed.userId).toBe('u-1')
    expect(parsed.path).toBe('/api/x')
  })

  it('explicit context overrides ambient context', async () => {
    const { logger } = await import('@/lib/logger')
    const { runWithRequestContext, makeRequestContext } = await import('@/lib/logger/context')

    await runWithRequestContext(makeRequestContext({ requestId: 'als-base' }), () => {
      logger.info('override', { requestId: 'override-id' })
    })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.requestId).toBe('override-id')
  })

  it('works fine without an ambient context', async () => {
    const { logger } = await import('@/lib/logger')
    expect(() => logger.info('no context')).not.toThrow()
    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.requestId).toBeUndefined()
  })
})

describe('logger — persistLog (Supabase fire-and-forget)', () => {
  it('does NOT call fetch in non-production environment', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')

    const { logger } = await import('@/lib/logger')
    logger.error('should not persist outside production')

    await new Promise((r) => setTimeout(r, 10))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('calls fetch with correct Supabase REST endpoint in production', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key')

    const { logger } = await import('@/lib/logger')
    logger.error('prod error message', { path: '/api/orders' })

    await new Promise((r) => setTimeout(r, 20))

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://proj.supabase.co/rest/v1/server_logs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'svc-key',
          'Content-Type': 'application/json',
        }),
      })
    )

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.level).toBe('error')
    expect(body.message).toBe('prod error message')
    expect(body.route).toBe('/api/orders')
  })

  it('also persists warn level in production', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key')

    const { logger } = await import('@/lib/logger')
    logger.warn('high memory usage')

    await new Promise((r) => setTimeout(r, 20))
    expect(fetchSpy).toHaveBeenCalledOnce()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.level).toBe('warn')
  })

  it('does NOT persist info or debug levels in production', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key')

    const { logger } = await import('@/lib/logger')
    logger.info('routine info')
    logger.debug('verbose debug')

    await new Promise((r) => setTimeout(r, 20))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('silently ignores fetch failures (never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key')

    const { logger } = await import('@/lib/logger')
    expect(() => logger.error('fetch will fail')).not.toThrow()
    await new Promise((r) => setTimeout(r, 20))
  })

  it('skips fetch when env vars are missing', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    const { logger } = await import('@/lib/logger')
    logger.error('missing env vars')

    await new Promise((r) => setTimeout(r, 20))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('persisted body carries redacted context (no raw emails, no passwords)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key')

    const { logger } = await import('@/lib/logger')
    logger.error('boom', { password: 'hunter2', note: 'user x@y.com' })

    await new Promise((r) => setTimeout(r, 20))
    expect(fetchSpy).toHaveBeenCalled()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const asString = JSON.stringify(body)
    expect(asString).not.toContain('hunter2')
    expect(asString).not.toContain('x@y.com')
    expect(asString).toContain('[redacted]')
  })
})

describe('logger.child', () => {
  it('returns a child logger with fixed context', async () => {
    const { logger } = await import('@/lib/logger')
    const child = logger.child({ requestId: 'fixed-req', userId: 'fixed-user' })
    child.info('child message', { action: 'TEST' })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.requestId).toBe('fixed-req')
    expect(parsed.userId).toBe('fixed-user')
    expect(parsed.action).toBe('TEST')
    expect(parsed.message).toBe('child message')
  })

  it('child context can be overridden per call', async () => {
    const { logger } = await import('@/lib/logger')
    const child = logger.child({ requestId: 'base-req' })
    child.info('override test', { requestId: 'override-req' })

    const parsed = parseLastLog(console.log as ReturnType<typeof vi.spyOn>)
    expect(parsed.requestId).toBe('override-req')
  })

  it('child.error propagates error correctly', async () => {
    const { logger } = await import('@/lib/logger')
    const child = logger.child({ requestId: 'r1' })
    child.error('child error', { error: new Error('child fail') })

    expect(console.error).toHaveBeenCalledOnce()
    const parsed = parseLastLog(console.error as ReturnType<typeof vi.spyOn>)
    expect(parsed.errorMessage).toBe('child fail')
    expect(parsed.requestId).toBe('r1')
  })
})
