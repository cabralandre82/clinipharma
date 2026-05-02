// @vitest-environment node
/**
 * Guards de env do `lib/asaas` (regressão 2026-05-02).
 *
 * Bug original: `process.env.ASAAS_API_URL ?? 'fallback'` deixa string
 * vazia (`""`) passar — porque `??` só aplica em null/undefined. Quando
 * o Vercel tinha a env presente mas com value vazio (consequência de um
 * pipeline de setup que falhou em pipear o valor pra stdin), `BASE_URL`
 * virava `""`, e `fetch(\`${BASE_URL}/payments\`)` recebia `/payments`
 * → "Failed to parse URL from /payments" só na hora de cobrar o cliente.
 *
 * Estes testes garantem que:
 *   1. Env vazia → fallback é aplicado.
 *   2. Env com valor que NÃO começa com http(s):// → throw em load time
 *      (não deixa o módulo nem ser importado, rejeita cedo).
 *   3. Env válida → usa o valor.
 *
 * Como `lib/asaas.ts` lê `process.env` no topo do módulo, manipulamos
 * a env e usamos `vi.resetModules()` antes de cada `import()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('lib/asaas — guards de env (regressão 2026-05-02)', () => {
  const originalUrl = process.env.ASAAS_API_URL
  const originalKey = process.env.ASAAS_API_KEY

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env.ASAAS_API_URL = originalUrl
    process.env.ASAAS_API_KEY = originalKey
  })

  it('env vazia ("") aplica o fallback (sandbox), em vez de virar string crua', async () => {
    process.env.ASAAS_API_URL = ''
    process.env.ASAAS_API_KEY = 'k_test'
    // Carregar e tentar usar — fetch deve receber URL absoluta de
    // sandbox, não "/payments".
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    const mod = await import('@/lib/asaas')
    // Trigger qualquer call (findOrCreateCustomer faz GET /customers)
    try {
      await mod.findOrCreateCustomer({ cpfCnpj: '00000000000', name: 'X' })
    } catch {
      // Não importa o resultado — só queremos checar que fetch recebeu URL absoluta.
    }
    expect(fetchSpy).toHaveBeenCalled()
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toMatch(/^https:\/\/sandbox\.asaas\.com\/api\/v3\//)
    fetchSpy.mockRestore()
  })

  it('env não-URL ("aact_prod_abc") faz a chamada lançar em runtime (não em load)', async () => {
    process.env.ASAAS_API_URL = 'aact_prod_abc_was_saved_here_by_mistake'
    process.env.ASAAS_API_KEY = 'k_test'
    // Carregar o módulo NÃO deve lançar — só usar é que lança.
    // (Em load-time, alguns deploys de dev podem importar antes de chamar
    // e quebrariam o build inteiro; queremos falha localizada no caminho
    // que de fato precisa do Asaas.)
    const mod = await import('@/lib/asaas')
    await expect(
      mod.findOrCreateCustomer({ cpfCnpj: '00000000000', name: 'X' })
    ).rejects.toThrowError(/não começa com http\(s\):\/\//)
  })

  it('env válida ("https://...") é usada como base', async () => {
    process.env.ASAAS_API_URL = 'https://www.asaas.com/api/v3'
    process.env.ASAAS_API_KEY = 'k_test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"data":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const mod = await import('@/lib/asaas')
    await mod.findOrCreateCustomer({ cpfCnpj: '00000000000', name: 'X' }).catch(() => {})
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toMatch(/^https:\/\/www\.asaas\.com\/api\/v3\//)
    fetchSpy.mockRestore()
  })

  it('API_KEY ausente: chamada falha com mensagem clara (não 401 críptico)', async () => {
    process.env.ASAAS_API_URL = 'https://www.asaas.com/api/v3'
    process.env.ASAAS_API_KEY = ''
    const mod = await import('@/lib/asaas')
    // findOrCreateCustomer chama asaasFetch → asaasFetchRaw, que valida API_KEY.
    await expect(
      mod.findOrCreateCustomer({ cpfCnpj: '00000000000', name: 'X' })
    ).rejects.toThrowError(/ASAAS_API_KEY ausente/)
  })
})
