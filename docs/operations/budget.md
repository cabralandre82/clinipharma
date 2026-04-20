# Operational Budget

**Uso:** previsão e reconciliação mensal dos custos de infraestrutura e SaaS da plataforma. Mantém o operador no controle do custo variável e serve como sinal precoce de abuso (custo súbito = alguém está fazendo algo a mais).

**Atualização:**

- **Semanal:** operator compara uso atual com previsão (seção 3). Ver [`docs/SOLO_OPERATOR.md`](../SOLO_OPERATOR.md) §4 — ritual semanal.
- **Mensal:** fechamento do mês passado, atualização da previsão para o próximo. Ver SOLO_OPERATOR §5 — ritual mensal.

**Kill-switch:** se qualquer linha passar **2× a previsão** em um mês, parar escalonamento imediatamente e abrir incidente operacional.

---

## 1. Cost guard em CI

O workflow [`.github/workflows/cost-guard.yml`](../../.github/workflows/cost-guard.yml) roda a cada push e falha o build se:

- Tamanho do bundle crescer > 10%.
- Qualquer dependência pesada (> 500KB minified) for adicionada sem label explícito.
- Query ao banco sem index for detectada em migration nova.

Esse gate não cobre custo de runtime — **este documento cobre runtime**.

---

## 2. Orçamento por categoria (mensal, em BRL)

| Categoria                 |     Previsão | Teto (kill-switch) | Fornecedor(es)              | Notas                                                    |
| ------------------------- | -----------: | -----------------: | --------------------------- | -------------------------------------------------------- |
| **Hospedagem app**        |       R$ 100 |             R$ 300 | Vercel (Pro plan)           | Edge runtime + serverless minutes.                       |
| **Banco de dados**        |       R$ 250 |             R$ 600 | Supabase (Pro)              | Inclui PITR e storage. Dobrar se habilitar réplica read. |
| **Redis / rate-limit**    |        R$ 50 |             R$ 150 | Upstash                     | Requests + eviction.                                     |
| **Error monitoring**      |       R$ 120 |             R$ 300 | Sentry (Team)               | Events + transactions. Cliente instrumentado.            |
| **E-mail transacional**   |        R$ 80 |             R$ 250 | Resend                      | Precificação por envio.                                  |
| **SMS / WhatsApp**        |       R$ 200 |             R$ 500 | Zenvia                      | Escala com MAU.                                          |
| **Pagamentos**            |         R$ 0 |              R$ 50 | Asaas (taxas por transação) | Fora deste orçamento — repassado ao cliente.             |
| **Assinatura digital**    |       R$ 150 |             R$ 400 | Clicksign                   | Por documento assinado.                                  |
| **Event bus / jobs**      |        R$ 50 |             R$ 200 | Inngest                     | Cresce com volume de jobs.                               |
| **AI (se ativado)**       |         R$ 0 |             R$ 300 | OpenAI/Anthropic            | Usado só para features opt-in. Monitorar tokens.         |
| **CDN / assets**          |         R$ 0 |             R$ 100 | Vercel (incluído)           | Explicitar se migrar.                                    |
| **Backups off-site**      |        R$ 30 |             R$ 100 | AWS S3 (cross-region)       | Storage + egress.                                        |
| **DAST / security scans** |         R$ 0 |             R$ 100 | ZAP (self-hosted em CI)     | Runner minutes.                                          |
| **Dominios + SSL**        |        R$ 15 |              R$ 50 | Registro.br                 | Anualizado → R$ 15/mês.                                  |
| **1Password / secrets**   |        R$ 40 |             R$ 100 | 1Password Business          | Por seat.                                                |
| **Total previsto**        | **R$ 1.085** |       **R$ 3.500** |                             | Considera 100 usuários ativos, 500 orders/mês.           |

---

## 3. Fatores que mudam o custo

- **Número de MAU** — maior volume = Supabase + Zenvia + Resend crescem linearmente.
- **Número de orders/mês** — Clicksign + Asaas crescem linearmente.
- **Número de ambientes** — cada preview environment no Vercel pode chamar Supabase, Upstash e Resend. Usar mocks em preview ajuda.
- **Erros em produção** — Sentry cobra por event. Um loop de erro = spike de custo.
- **Crons com falha** — alguns crons rodam a cada minuto; se ficarem retriando, gastam minutos serverless.

---

## 4. Alertas de custo em vigor

| Alerta                                 | Threshold    | Canal           | Ação                         |
| -------------------------------------- | ------------ | --------------- | ---------------------------- |
| Sentry events > 80% do quota mensal    | 80% de quota | E-mail Sentry   | Revisar errors dominantes.   |
| Vercel bandwidth > 80%                 | 80% de plano | E-mail Vercel   | Cache-Control, imagens, etc. |
| Supabase DB size > 80%                 | 80% de plano | E-mail Supabase | Revisar retenção, vacuum.    |
| Upstash requests > previsão diária × 3 | > 3x         | Grafana         | Investigar loop ou abuso.    |
| Resend emails enviados > previsão × 2  | > 2x         | E-mail Resend   | Checar loop de notificação.  |

---

## 5. Ritual de reconciliação

### 5.1 Semanal (15 min)

1. Ler dashboard de cada fornecedor → anotar uso do mês-a-date.
2. Comparar com previsão proporcional (ex.: dia 10 = ~33% da previsão).
3. Se algo está ≥ 1.5× o esperado → investigar **antes** do fim do mês.
4. Registrar números em `docs/operations/cost-log.md` (criar se não existir).

### 5.2 Mensal (30 min)

1. Fechar o mês: número final por categoria.
2. Comparar com previsão (variação % por linha).
3. Atualizar a tabela §2 se:
   - Tendência estável por 2 meses ≠ previsão.
   - Novo fornecedor foi adicionado.
4. Se o total total ultrapassou previsão em > 20%, abrir issue de revisão de arquitetura.

---

## 6. Otimizações disponíveis (lista viva)

- [ ] Revisar políticas de retenção para reduzir Supabase storage.
- [ ] Aumentar TTL do cache em `/api/status/summary` (hoje 60s) se tráfego aumentar.
- [ ] Substituir Sentry por OpenTelemetry self-hosted (só considerar se Sentry virar top 3 custo).
- [ ] Consolidar Upstash em uma única instance compartilhada (hoje pode ter múltiplas).
- [ ] Mover E-mails de broadcast para serviço dedicado (se volume > 10k/mês).

---

## 7. Anti-patterns

- **Nunca** aumentar teto (kill-switch) permanentemente para evitar um alerta. Investigar primeiro.
- **Nunca** aceitar conta de fornecedor sem reconciliar com dashboard. Erros de billing acontecem.
- **Nunca** otimizar custo de fornecedor secundário (< 5% do total) enquanto os top-3 não estão sob controle.

---

## 8. Referências

- [`docs/SOLO_OPERATOR.md`](../SOLO_OPERATOR.md) — rituais que consomem este documento.
- [`.github/workflows/cost-guard.yml`](../../.github/workflows/cost-guard.yml) — gate de CI.
- [`docs/compliance/subprocessors.md`](../compliance/subprocessors.md) — mesma lista de fornecedores sob lente de compliance.
- Dashboards externos: Vercel, Supabase, Upstash, Sentry, Resend, Zenvia, Clicksign, Inngest.
