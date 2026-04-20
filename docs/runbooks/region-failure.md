# Runbook — Region Failure (Region-wide Outage)

**Severidade default:** P0.
**Origem:** indisponibilidade simultânea da plataforma Vercel OU do Supabase em toda uma região da AWS (em geral `us-east-1`, onde está hospedado o projeto Supabase).

**SLO relacionado:**

- RTO alvo para region-failure: **4h** (fail-over não automático — requer decisão e ação manual).
- RPO alvo: **24h** (último backup off-site em S3 cross-region).

**Diferença em relação a [`database-unavailable.md`](database-unavailable.md):** aquele runbook assume que o problema é local ao projeto Supabase (pool esgotado, migration travada). Este runbook assume que **toda a região da AWS está degradada** — múltiplos SaaS offline ao mesmo tempo.

---

## 1. Sintomas / gatilhos

- Vercel mostra status page vermelho em múltiplas funções (não só a nossa app).
- Supabase status page vermelho/amarelo em região `us-east-1`.
- AWS Service Health Dashboard com degradação em `us-east-1`.
- Múltiplos SaaS dependentes (Resend, Sentry, Upstash) simultaneamente offline.
- `/api/health/deep` retorna 503 de múltiplas dependências **ao mesmo tempo**.

## 2. Impacto no cliente

- **Total.** Aplicação indisponível para todos os usuários.
- Crons não executam (mas backlog de jobs fica preservado no Inngest, dependendo do escopo da falha).
- E-mails transacionais não chegam.
- Webhooks de entrada (Asaas, Clicksign) podem acumular OU se perder, dependendo do vendor.

## 3. Primeiros 15 minutos — triagem

### 3.1 Confirmar que é region failure (não nosso)

Verificar **antes** de qualquer ação:

- AWS Service Health Dashboard: `https://health.aws.amazon.com/health/status`
- Vercel Status: `https://www.vercel-status.com/`
- Supabase Status: `https://status.supabase.com/`
- Upstream SaaS: Sentry, Resend, Upstash, Asaas, Clicksign.

**Critério:** se ≥ 3 SaaS hospedados na mesma região reportam incident simultâneo, é region failure. Se apenas um, seguir o runbook específico daquele SaaS (ex.: [`external-integration-down.md`](external-integration-down.md)).

### 3.2 Decidir entre esperar ou failover

| Condição                                              | Ação                                           |
| ----------------------------------------------------- | ---------------------------------------------- |
| AWS reporta ETA ≤ 1h                                  | **Esperar** + comunicar clientes.              |
| AWS reporta ETA 1–4h                                  | Esperar, mas preparar failover.                |
| AWS reporta ETA > 4h OU "investigando"                | **Failover** (ver §5).                         |
| Dados críticos corrompidos (não apenas indisponíveis) | [`emergency-restore.md`](emergency-restore.md) |

**Decisão da primeira hora deve ser registrada** em `docs/security/incidents/<id>/decision-log.md` com timestamp e quem decidiu.

### 3.3 Comunicação imediata

- Status page atualizada com Template 4 de [`docs/templates/incident-comms.md`](../templates/incident-comms.md).
- E-mail para clientes: Template 1 + "estamos dependendo do retorno da AWS, tempo estimado {X}. Próxima atualização em 30 min."

## 4. Diagnóstico — estado preservado do sistema

O que continua funcionando mesmo na falha regional:

- **Backups off-site em S3 cross-region.** Ver `backup_runs.storage_location`; regra de backup multi-region está em [`scripts/dr/`](../../scripts/dr/).
- **Inngest** (event bus) — hospedado independente; jobs em fila permanecem.
- **Documentação** — este repo.
- **Segredos no Vercel/1Password** — não dependem de runtime.

O que **não** funciona:

- Banco de dados.
- API da aplicação.
- Sessions em Upstash Redis (users ficam deslogados quando voltar).
- E-mails transacionais (Resend).

## 5. Failover (quando a espera não cabe)

Opção disponível: **restore off-site + novo projeto Supabase em outra região.**

> Este procedimento cria uma versão temporária da aplicação com **perda de todos os dados gerados após o último backup off-site** (RPO = 24h típico). Exige aprovação do operator/founder.

### 5.1 Pré-requisitos

- Acesso ao bucket S3 de backups com credencial cross-region válida.
- Projeto Supabase "DR" previamente provisionado em região alternativa (ex.: `eu-west-1`) OU capacidade de provisionar rapidamente.
- Documentar decisão em `docs/security/incidents/<id>/failover-approval.md`.

### 5.2 Passos

1. **Notificar clientes** que haverá janela de manutenção estendida e **perda de dados do dia**.
2. **Novo projeto Supabase** em região alternativa, com mesmas migrations aplicadas.
3. **Restaurar último backup off-site** (ver [`emergency-restore.md`](emergency-restore.md) §6.2).
4. **Rotar env vars** no Vercel para apontar ao projeto DR:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`.
5. **Substituir Upstash** por instância alternativa se Upstash também afetado:
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
6. **Resend/SMS:** sem failover automático. Aceitar degradação; documentar.
7. **Redeploy** — Vercel → Redeploy latest commit.
8. **Validar** com [`emergency-restore.md`](emergency-restore.md) §7.

## 6. Reconciliação quando a região principal voltar

Se um failover foi feito, temos dois bancos com estados divergentes (DR com dados de hoje + original com dados de 24h atrás).

### 6.1 Avaliar divergência

```sql
-- No banco DR
select max(sequence_num) from audit_logs;

-- No banco original (quando voltar)
select max(sequence_num) from audit_logs;
```

### 6.2 Estratégia

- **Caso A — DR operou por pouco tempo (< 2h):** reconciliar manualmente. Exportar escrita do DR, aplicar em original após verificar conflitos.
- **Caso B — DR operou por muito tempo (> 2h):** declarar DR como "a nova fonte da verdade" e fazer failback completo para DR, abandonando o original ou revertendo-o via restore.

**Em ambos os casos:** registrar decisão em post-mortem. Sem reconciliação, há risco de confusão de estado nas semanas seguintes.

## 7. Verificação pós-incidente

- [ ] Status page marcada como "Resolved".
- [ ] Ingestão de webhooks atrasados processada (Asaas/Clicksign reenviam, mas verificar não-perda).
- [ ] Nenhum `audit_chain_break` detectado pelo primeiro ciclo de `verify-audit-chain` pós-cutover.
- [ ] E-mails atrasados foram reenfileirados ou comunicados como não entregues.
- [ ] `rls_canary` verde.
- [ ] Novo backup forçado manualmente.
- [ ] DPO informado se dados de cliente foram perdidos.

## 8. Post-mortem

Obrigatório para qualquer region-failure que afete clientes ≥ 15 min.

Focos específicos:

- Quanto tempo levou para decidir entre esperar e failover?
- O que foi perdido? (janela RPO real vs nominal)
- Há SaaS concentrados demais na mesma região? (concentration risk)
- O DR drill mais recente preparou para isso? Se não, expandir o drill.

## 9. Prevenção

- Garantir que todo backup está em S3 cross-region. Verificar periodicidade.
- DR drill trimestral deve incluir rotar env vars para DR project real (não apenas staging).
- Manter projeto Supabase DR "quente" (migrations sempre aplicadas).
- Monitorar concentration risk: todos nossos vendors em `us-east-1` é fragilidade.

## 10. Anti-patterns

- **Nunca** iniciar failover antes de confirmar que AWS não vai recuperar em janela aceitável. Failover é caro e gera divergência de dados.
- **Nunca** comunicar "o sistema vai voltar em X horas" se a ETA é da AWS — repassa incerteza como nossa certeza.
- **Nunca** reconciliar bancos divergentes sem registrar cada escolha. Post-mortem depende disso.

---

## Referências

- Runbook: [`docs/runbooks/database-unavailable.md`](database-unavailable.md) (falha local, não regional).
- Runbook: [`docs/runbooks/external-integration-down.md`](external-integration-down.md) (falha de um único vendor).
- Runbook: [`docs/runbooks/emergency-restore.md`](emergency-restore.md) (restore a partir de backup).
- Skill: [`.cursor/skills/backup-verify/SKILL.md`](../../.cursor/skills/backup-verify/SKILL.md).
- Drill mais recente: [`docs/runbooks/dr-drill-2026-04.md`](dr-drill-2026-04.md).
- Scripts: [`scripts/dr/`](../../scripts/dr/).
- Templates: [`docs/templates/incident-comms.md`](../templates/incident-comms.md).
