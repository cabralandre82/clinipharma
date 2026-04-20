# Runbook — Emergency Restore

**Severidade default:** P0.
**Origem:** data loss confirmado (corrupção, deleção acidental, ransomware, tampering do audit chain com impacto em dados), ou requisição formal de restauração para um ponto no tempo específico (legal, regulatório).

**SLO operacional:**

- RPO alvo: 24h (backups diários em `backup_runs`).
- RTO alvo: 2h até o sistema operante; 4h até dados consistentes validados.

**Skill acionadora:** [`.cursor/skills/backup-verify/SKILL.md`](../../.cursor/skills/backup-verify/SKILL.md) + este runbook.

---

## 1. Sintomas / gatilhos

- Relato de cliente com dados ausentes ou alterados.
- Alerta `audit_chain_break_total > 0` persistente após triagem.
- Alerta `backup_freshness_breach_total > 0` combinado com incidente de banco.
- Decisão legal de restaurar estado anterior (legal hold com restore).
- Confirmação de intrusão com escrita não autorizada.

## 2. Impacto no cliente

- Variável. Pode ser impacto zero (restore a partir de snapshot idêntico) ou total (rollback de várias horas).
- **Toda restore apaga ou sobrescreve escritas feitas após o ponto de restore**. Comunicação ao cliente é obrigatória.

## 3. Primeiros 10 minutos (containment)

1. **Declarar incidente P0.** Seguir [`docs/on-call.md`](../on-call.md).
2. **Pausar Vercel deployments.** Project → Settings → Pause Deployments.
3. **Colocar a aplicação em read-only** se possível (feature flag `writes.enabled=false` se existir; alternativamente, pausar Inngest + desativar `/api/orders/*` via Vercel "Preview" mode).
4. **Congelar crons** que podem mutar dados:
   - Setar feature flags correspondentes para `false` em cada cron crítico.
   - Ou: desabilitar crons no Vercel Dashboard → Cron Jobs.
5. **Preservar evidência.** Antes de tocar em QUALQUER backup:
   ```sql
   select * from backup_runs
    order by created_at desc
    limit 20;
   ```
   Copiar o output para `docs/security/incidents/<id>/backup-state-before-restore.md`.

## 4. Diagnóstico — qual ponto no tempo?

### 4.1 — Data loss acidental (deleção/corrupção conhecida)

- Identificar o commit/rollout/ação que causou a perda.
- Ponto de restore: **imediatamente antes** daquela ação.
- Usar `cron_runs` + `server_logs` + `audit_logs` para cercar o momento.

### 4.2 — Tampering / intrusão

- Usar `audit_chain_checkpoints` para identificar último checkpoint íntegro.
- Ponto de restore: imediatamente antes do `firstBrokenSeq` do alerta de chain break.
- Ver [`docs/runbooks/audit-chain-tampered.md`](audit-chain-tampered.md) §5.

### 4.3 — Legal/regulatório

- Ponto de restore definido pela solicitação (ordem judicial, DPO, ANPD).
- Anexar justificativa formal em `docs/security/incidents/<id>/legal-request.md`.

## 5. Avaliação do backup disponível

```sql
-- Backups disponíveis ordenados do mais recente para o mais antigo
select id, created_at, storage_location, size_bytes, sha256, chain_prev_sha256
  from backup_runs
 where created_at >= now() - interval '30 days'
 order by created_at desc;
```

**Verificações obrigatórias antes do restore:**

1. **Integridade do chain.** Cada linha de `backup_runs` tem `chain_prev_sha256`; rodar verificação:
   ```bash
   npm run backup:verify-chain
   ```
2. **Freshness.** Se `created_at` do backup > 24h antes do ponto de restore desejado → perda adicional de dados é inevitável; documentar gap.
3. **Restore drill recente.** O cron `restore-drill` valida trimestralmente que backups são restauráveis. Ver `restore_drill_last_success_ts` em `/api/health/deep`. Se > 90 dias sem drill bem-sucedido, risco **alto** de surpresa.

## 6. Execução do restore (Supabase)

> Este procedimento **sobrescreve o banco de dados de produção**. Exige aprovação do DPO registrada em `docs/security/incidents/<id>/approval.md`.

### 6.1 — Restore nativo do Supabase (Point-in-Time Recovery)

Se o plano Supabase inclui PITR (Pro+):

1. Supabase Dashboard → Database → Backups → PITR.
2. Selecionar timestamp-alvo (ver §4).
3. Clicar **Restore to new project** (NÃO restore in-place na primeira tentativa).
4. Aguardar conclusão (pode levar horas para datasets grandes).
5. Validar (ver §7) no novo projeto.
6. Se validação passar: aplicar cutover (ver §8).

### 6.2 — Restore a partir de backup S3 off-site

Se PITR não disponível, ou para garantir 2º ponto de restore independente:

1. Identificar URI do backup em `backup_runs.storage_location` (formato `s3://...`).
2. Validar SHA-256 do artefato baixado vs `backup_runs.sha256`.
3. Criar novo projeto Supabase temporário (NÃO restore em produção).
4. Restaurar dump:
   ```bash
   psql "$RESTORE_TARGET_URL" < dump.sql
   ```
5. Rodar migrations pendentes entre o ponto-de-backup e o estado-alvo:
   ```bash
   supabase db push --db-url "$RESTORE_TARGET_URL"
   ```
6. Validar (ver §7).

## 7. Validação pré-cutover

No projeto de restore (ainda não em produção):

```sql
-- Contagens esperadas
select count(*) from orders where created_at < '<T_RESTORE>';
select count(*) from audit_logs where created_at < '<T_RESTORE>';
select max(sequence_num) from audit_logs;

-- Hash chain íntegro no restore
select * from audit_chain_checkpoints order by sequence_num desc limit 5;
```

**Critérios de go/no-go:**

- [ ] Contagens de registros batem com snapshot esperado.
- [ ] `audit_chain` verifica sem break.
- [ ] Amostra aleatória de 10 orders recuperáveis e lidas via app (aplicação apontada ao DB de restore em ambiente staging).
- [ ] RLS canary roda verde (`rls-canary` cron manual).
- [ ] DPO assinou aprovação.

## 8. Cutover para produção

> **Ponto de não-retorno.** Escritas pós-restore serão irrecuperáveis.

1. **Final seal on old DB:** executar `pg_dump --snapshot` no banco atual; salvar como evidência de "estado pré-restore".
2. **Reconectar aplicação ao DB restaurado:**
   - Opção A (PITR): Supabase Dashboard → "Restore in-place" após validação no clone, OU
   - Opção B (S3): rotar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` no Vercel para apontar ao novo projeto.
3. **Reativar Vercel deployments** (Settings → Pause Deployments toggle OFF).
4. **Reativar crons** um por um (ver `vercel.json`) começando por `rls-canary`, `verify-audit-chain`, `backup-freshness`. Só reativar os de mutação depois.
5. **Reativar writes** na aplicação (flag `writes.enabled=true` ou equivalente).

## 9. Verificação pós-cutover

- `/api/health/deep` retorna `ok` em todos os checks.
- `rls-canary` roda verde.
- `verify-audit-chain` roda verde na nova chain.
- Relato de usuários via `support_tickets` monitorado por 24h.
- Novo `backup_runs` criado explicitamente pós-cutover (não esperar o cron diário).

## 10. Comunicação

- **Durante:** Template 1 de [`docs/templates/incident-comms.md`](../templates/incident-comms.md), atualizações a cada 30 min.
- **Pós-cutover:** Template 3.
- **LGPD Art. 48:** se dados pessoais foram perdidos (não apenas sobrescritos para estado consistente), seguir [`docs/runbooks/data-breach-72h.md`](data-breach-72h.md). Data loss pode ser incidente notificável.

## 11. Post-mortem

Abrir em até 3 dias úteis. Template: [`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md).

Focos específicos:

- Quanto do gap entre "último backup" e "ponto-de-restore" é aceitável? Se > 1h é surpresa → RPO real é pior que declarado.
- Foi necessário algum passo ad-hoc? → virar automação.
- Drill mais recente teria detectado o problema? → Se não, expandir o drill.

## 12. Prevenção

- Dobrar frequência de `restore-drill` (trimestral → bimestral) por 12 meses após incidente de data loss real.
- Revisar RPO contratual se necessário (comunicar clientes).
- Investigar se PITR deveria ser habilitado se ainda não for.

---

## Referências

- Skill: [`.cursor/skills/backup-verify/SKILL.md`](../../.cursor/skills/backup-verify/SKILL.md).
- Runbook irmão: [`docs/runbooks/audit-chain-tampered.md`](audit-chain-tampered.md).
- Runbook irmão: [`docs/runbooks/region-failure.md`](region-failure.md).
- Runbook: [`docs/runbooks/database-unavailable.md`](database-unavailable.md).
- Cron: `backup-freshness` + `restore-drill` em `vercel.json`.
- Ledger: `supabase/migrations/053_backup_runs.sql`.
- Hash chain de audit: `supabase/migrations/046_audit_hash_chain.sql`.
