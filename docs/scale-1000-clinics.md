# Plano de Escala: 1000+ Clínicas

> Documento técnico elaborado durante a auditoria pré-release (Abril 2026).  
> Responde à pergunta: **"E se fosse uma operação com mais de 1000 clínicas?"**

---

## 1. O que já foi feito (base sólida)

| Área                | Implementação atual                               |
| ------------------- | ------------------------------------------------- |
| Índices de DB       | 14 índices críticos em tabelas de alta frequência |
| Rate limiting       | Em memória por instância                          |
| Cron (stale orders) | O(1) — batch query por pharmacy_members           |
| RLS                 | Políticas por tabela; dados isolados por entidade |
| Precisão financeira | `numeric(15,2)` em todas as colunas monetárias    |
| Soft delete         | `deleted_at` em todas as entidades principais     |
| Auditoria           | `audit_logs` para todas as mutações críticas      |

---

## 2. Gargalos identificados para 1000+ clínicas

### 2.1 Rate Limiter em Memória → Distribuído

**Problema atual:** O `lib/rate-limit.ts` usa um `Map` em memória. Com Vercel serverless, cada função tem sua própria instância — o rate limit não é compartilhado entre deploys/instâncias.

**Solução para escala:**

```typescript
// Substituir por Upstash Redis
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, '1 m'),
})
```

**Custo estimado:** ~$10/mês para 1000 clínicas com uso normal.

---

### 2.2 Particionamento de Tabelas

**Problema:** Com 1000 clínicas fazendo pedidos diariamente, `orders` acumulará ~360.000+ registros/ano. `audit_logs` e `access_logs` crescem ainda mais rápido.

**Solução:**

```sql
-- Particionar orders por created_at (mensal)
CREATE TABLE orders_2026_01 PARTITION OF orders
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Particionar audit_logs por created_at (mensal)
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

**Automação:** Criar partições futuras via cron mensal antes do mês virar.

---

### 2.3 Pool de Conexões — PgBouncer Tuning

**Situação atual:** Supabase usa PgBouncer por padrão. Com 1000 clínicas simultâneas, é necessário:

- `max_client_conn`: 1000 (revisar plano Supabase)
- `default_pool_size`: 25 por usuário de DB
- Modo: `transaction` pooling (já é o padrão Supabase)

**Ação:** Migrar para plano Supabase Pro/Team e configurar:

```
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
```

---

### 2.4 Cron de Stale Orders — Escala

**Situação atual:** O cron percorre todos os pedidos abertos e notifica por farmácia. Já foi corrigido para O(1) (batch query). Mas com 1000 clínicas e 50+ status por pedido:

**Estimativa:** 1000 clínicas × 3 pedidos médios ativos = 3.000 pedidos a processar por cron.

**Para escala:**

```typescript
// Processar em batches de 100 para evitar timeout Vercel (10s)
const BATCH_SIZE = 100
for (let i = 0; i < staleOrders.length; i += BATCH_SIZE) {
  const batch = staleOrders.slice(i, i + BATCH_SIZE)
  await Promise.all(batch.map(processStaleOrder))
}
```

**Solução mais robusta:** Migrar cron para Inngest ou BullMQ com workers dedicados.

---

### 2.5 Relatórios e Exportações

**Problema:** O endpoint `/api/export` carrega TODOS os registros em memória para gerar CSV/XLSX. Com 1000 clínicas, um relatório de pedidos pode ter 50.000+ linhas.

**Solução — Streaming:**

```typescript
// Stream CSV ao invés de buffer em memória
export async function GET(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      const cursor = await db.from('orders').select('*').order('created_at')
      // Paginar em chunks de 1000
      for await (const chunk of paginate(cursor, 1000)) {
        controller.enqueue(toCSVChunk(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/csv' } })
}
```

---

### 2.6 Dashboard — Cache de Métricas

**Problema:** O dashboard do Super Admin carrega métricas agregadas (total de clínicas, pedidos, faturamento) em tempo real. Com 1000 clínicas, cada load faz 5-8 queries pesadas.

**Solução:**

```typescript
// Cache de 5 minutos com Vercel KV ou Upstash
import { kv } from '@vercel/kv'

export async function getDashboardMetrics() {
  const cached = await kv.get('dashboard:metrics')
  if (cached) return cached

  const metrics = await computeMetrics() // queries pesadas
  await kv.setex('dashboard:metrics', 300, metrics) // TTL 5min
  return metrics
}
```

**Alternativa sem custo extra:** `unstable_cache` do Next.js 15 com tag revalidation.

---

### 2.7 Notificações Push — Escala

**Problema:** `sendPushToRole('SUPER_ADMIN', ...)` busca todos os FCM tokens dos usuários com aquele papel e dispara N chamadas Firebase.

**Com escala:**

- 1000 clínicas = potencialmente milhares de usuários com notificações push
- Firebase tem limite de 500 mensagens por `sendEach()` call

**Solução:**

```typescript
// Chunkar envios Firebase em batches de 500
const FIREBASE_BATCH_SIZE = 500
const chunks = chunk(tokens, FIREBASE_BATCH_SIZE)
await Promise.allSettled(chunks.map((c) => messaging.sendEach(c)))
```

---

### 2.8 Monitoramento e Observabilidade

**O que falta para 1000+ clínicas:**

| Ferramenta                      | Uso                                    | Prioridade  |
| ------------------------------- | -------------------------------------- | ----------- |
| **Sentry**                      | Error tracking, performance traces     | CRÍTICO     |
| **Vercel Analytics**            | Web vitals, latência de routes         | ALTO        |
| **Supabase Advisor**            | Query performance, índices automáticos | ALTO        |
| **Uptime Robot / Betteruptime** | Alertas de downtime                    | MÉDIO       |
| **DataDog / Grafana**           | APM, dashboards custom                 | MÉDIO-LONGO |

---

### 2.9 Backup e Disaster Recovery

**Situação atual:** Supabase faz backup diário (plano Pro+).

**Para 1000+ clínicas:**

```bash
# Point-in-Time Recovery: habilitar no Supabase (plano Pro)
# WAL archiving: retém todos os writes, recuperação para qualquer ponto

# Backup adicional para objetos de Storage (documentos):
# - Replicar arquivos para S3 ou GCS como backup secundário
# - Retenção: 90 dias para documentos contratuais
```

---

### 2.10 Infraestrutura Multi-Região

**Para tolerância a falhas e latência:**

| Região      | Supabase         | Vercel | Público-alvo |
| ----------- | ---------------- | ------ | ------------ |
| `sa-east-1` | Primário (atual) | Edge   | Brasil       |
| `us-east-1` | Read replica     | Edge   | Backup/DR    |

**Quando implementar:** Acima de 500 clínicas ativas ou SLA contratual < 99.9%.

---

## 3. Índices adicionais recomendados para 1000+ clínicas

```sql
-- Queries de dashboard admin (aggregations)
CREATE INDEX idx_orders_created_at_status
  ON public.orders(created_at DESC, order_status);

CREATE INDEX idx_payments_status_created
  ON public.payments(status, created_at DESC);

-- Relatórios financeiros por período
CREATE INDEX idx_transfers_pharmacy_created
  ON public.transfers(pharmacy_id, created_at DESC);

CREATE INDEX idx_commissions_consultant_created
  ON public.consultant_commissions(consultant_id, created_at DESC);

-- Full-text search em pedidos (futuro)
CREATE INDEX idx_orders_code_gin
  ON public.orders USING gin(to_tsvector('portuguese', order_code));
```

---

## 4. Roadmap de escala por faixa de clínicas

| Faixa                 | Ações necessárias                                                      | Estimativa de custo mensal |
| --------------------- | ---------------------------------------------------------------------- | -------------------------- |
| **0–100 clínicas**    | Estado atual — nenhuma ação                                            | ~$50–100 (Supabase Pro)    |
| **100–300 clínicas**  | Sentry + Vercel Analytics + Upstash Redis rate limit                   | ~$200–400                  |
| **300–500 clínicas**  | Cache de métricas (KV) + particionamento de tabelas + streaming export | ~$400–800                  |
| **500–1000 clínicas** | Inngest para jobs assíncronos + read replica + multi-região            | ~$800–2.000                |
| **1000+ clínicas**    | DataDog APM + Firebase batch + Supabase Enterprise + CDN avançado      | ~$2.000–5.000              |

---

## 5. O que 95% de cobertura de testes requer

Os testes unitários atuais atingem **75.86% statements / 81.55% functions**. Para chegar a 95% são necessários:

### 5.1 Testes de Integração (missing 15-20%)

O código não coberto são **success paths** de server actions com múltiplas chamadas DB encadeadas (ex: `confirmPayment` envolve 8+ operações DB). Unit mocks não conseguem simular fidedignamente.

```bash
# Criar projeto Supabase de testes dedicado
SUPABASE_TEST_URL=https://xxxx.supabase.co
SUPABASE_TEST_SERVICE_ROLE=eyJ...

# Rodar migrations no projeto de teste
supabase db push --project-ref xxxx

# Executar testes de integração
npx vitest run tests/integration --config vitest.integration.config.ts
```

### 5.2 E2E com Playwright (missing flows)

```typescript
// Exemplos de flows que precisam de E2E:
test('complete order flow', async ({ page }) => {
  await loginAs(page, 'clinic_admin')
  await createOrder(page, { product: 'Produto X', qty: 2 })
  await loginAs(page, 'super_admin')
  await confirmPayment(page, { method: 'PIX' })
  await expect(page.locator('[data-status="CONFIRMED"]')).toBeVisible()
})
```

### 5.3 Testes de Carga (Stress Testing)

```bash
# k6 para simular 1000 clínicas simultâneas
k6 run --vus 1000 --duration 60s tests/load/order-flow.js
```

---

## 6. Checklist de aprovação para 1000+ clínicas

- [ ] Upstash Redis rate limiter instalado e configurado
- [ ] Sentry instalado e DSN configurado no Vercel
- [ ] Particionamento de `orders` e `audit_logs` implementado
- [ ] Cache de métricas do dashboard com TTL 5min
- [ ] Streaming de exports para CSV/XLSX
- [ ] Firebase push em batches de 500
- [ ] PgBouncer tuning no Supabase Pro
- [ ] PITR (Point-in-Time Recovery) ativado
- [ ] Runbook de incident response documentado
- [ ] Load testing com k6 aprovado (P99 < 2s)
- [ ] Testes de integração cobrindo success paths dos services
- [ ] SLA 99.9% contratual definido

---

_Documento gerado em Abril 2026 — Auditoria Pré-Release Clinipharma v1.7.0_
