import { describe, it, expect } from 'vitest'
import {
  runWithRequestContext,
  getRequestContext,
  updateRequestContext,
  makeRequestContext,
  withCronContext,
  withWebhookContext,
} from '@/lib/logger/context'

describe('logger/context', () => {
  describe('getRequestContext', () => {
    it('returns undefined outside a request scope', () => {
      expect(getRequestContext()).toBeUndefined()
    })

    it('returns the store inside runWithRequestContext', async () => {
      const ctx = makeRequestContext({ requestId: 'test-req' })
      await runWithRequestContext(ctx, () => {
        const got = getRequestContext()
        expect(got?.requestId).toBe('test-req')
      })
    })

    it('propagates through await chains', async () => {
      await runWithRequestContext(makeRequestContext({ requestId: 'chain-req' }), async () => {
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 5))
        expect(getRequestContext()?.requestId).toBe('chain-req')
      })
    })

    it('isolates concurrent scopes', async () => {
      const results: string[] = []
      const run = (id: string) =>
        runWithRequestContext(makeRequestContext({ requestId: id }), async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 10))
          results.push(getRequestContext()!.requestId)
        })

      await Promise.all([run('a'), run('b'), run('c')])
      expect(results.sort()).toEqual(['a', 'b', 'c'])
    })
  })

  describe('updateRequestContext', () => {
    it('mutates the active context', async () => {
      await runWithRequestContext(makeRequestContext({ requestId: 'u-1' }), () => {
        updateRequestContext({ userId: 'user-99' })
        expect(getRequestContext()?.userId).toBe('user-99')
      })
    })

    it('no-ops outside a scope (does not throw)', () => {
      expect(() => updateRequestContext({ userId: 'xx' })).not.toThrow()
    })
  })

  describe('makeRequestContext', () => {
    it('mints a random requestId and stamp by default', () => {
      const c = makeRequestContext()
      expect(c.requestId).toMatch(/^[0-9a-f-]{36}$/i)
      expect(typeof c.startedAt).toBe('number')
    })

    it('honours explicit partial fields', () => {
      const c = makeRequestContext({ requestId: 'abc', path: '/x', method: 'POST' })
      expect(c.requestId).toBe('abc')
      expect(c.path).toBe('/x')
      expect(c.method).toBe('POST')
    })
  })

  describe('withCronContext', () => {
    it('wraps a handler so logger sees requestId + path', async () => {
      const wrapped = withCronContext('nightly-task', async () => getRequestContext())
      const ctx = await wrapped()
      expect(ctx?.path).toBe('/cron/nightly-task')
      expect(ctx?.method).toBe('CRON')
      expect(ctx?.requestId).toBeTruthy()
    })

    it('passes arguments through', async () => {
      const wrapped = withCronContext('t', async (a: number, b: number) => a + b)
      expect(await wrapped(2, 3)).toBe(5)
    })
  })

  describe('withWebhookContext', () => {
    it('tags webhook source in path and method', async () => {
      const wrapped = withWebhookContext('asaas', async () => getRequestContext())
      const ctx = await wrapped()
      expect(ctx?.path).toBe('/webhook/asaas')
      expect(ctx?.method).toBe('WEBHOOK')
    })
  })
})
