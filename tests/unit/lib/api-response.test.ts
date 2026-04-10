import { describe, it, expect } from 'vitest'
import { apiSuccess, apiError, ApiErrors } from '@/lib/api-response'

describe('apiSuccess', () => {
  it('returns 200 by default with data and meta', async () => {
    const res = apiSuccess({ id: '1', name: 'test' })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toEqual({ id: '1', name: 'test' })
    expect(body.meta).toMatchObject({
      version: 'v1',
      timestamp: expect.any(String),
      requestId: expect.any(String),
    })
  })

  it('accepts custom status code', async () => {
    const res = apiSuccess({ created: true }, { status: 201 })
    expect(res.status).toBe(201)
  })

  it('includes X-Request-ID header', () => {
    const res = apiSuccess({ ok: true })
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })

  it('uses provided requestId in meta and header', async () => {
    const res = apiSuccess({}, { requestId: 'my-req-id' })
    const body = await res.json()
    expect(body.meta.requestId).toBe('my-req-id')
    expect(res.headers.get('X-Request-ID')).toBe('my-req-id')
  })
})

describe('apiError', () => {
  it('returns correct status and error shape', async () => {
    const res = apiError('NOT_FOUND', 'Resource not found', 404)
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'Resource not found' })
    expect(body.meta).toMatchObject({ version: 'v1' })
  })

  it('includes X-Request-ID header', () => {
    const res = apiError('BAD_REQUEST', 'Invalid input', 400)
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })
})

describe('ApiErrors', () => {
  it('unauthorized returns 401', () => {
    expect(ApiErrors.unauthorized().status).toBe(401)
  })

  it('forbidden returns 403', () => {
    expect(ApiErrors.forbidden().status).toBe(403)
  })

  it('notFound returns 404 with custom resource name', async () => {
    const res = ApiErrors.notFound('Pedido')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.message).toContain('Pedido')
  })

  it('badRequest returns 400 with provided message', async () => {
    const res = ApiErrors.badRequest('Campo obrigatório')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('Campo obrigatório')
  })

  it('tooManyRequests returns 429', () => {
    expect(ApiErrors.tooManyRequests().status).toBe(429)
  })

  it('internal returns 500', () => {
    expect(ApiErrors.internal().status).toBe(500)
  })

  it('serviceUnavailable returns 503 with service name', async () => {
    const res = ApiErrors.serviceUnavailable('Asaas')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.message).toContain('Asaas')
  })

  it('conflict returns 409', async () => {
    const res = ApiErrors.conflict('CNPJ já cadastrado')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.message).toBe('CNPJ já cadastrado')
  })
})
