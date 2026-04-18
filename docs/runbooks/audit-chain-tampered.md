# Runbook: `audit_logs` hash-chain tampered

**Gravidade:** 🔴 P1 — falha de integridade de evidência legal.
**Alerta de origem:** cron noturno `/api/cron/verify-audit-chain` (Vercel, 03:45 UTC). Sai em **cron_runs.status=failed** com `error='audit chain tampered: N of M rows failed verification (first broken seq=X)'`.
**Destinatário:** on-call engineer → Head of Engineering → Compliance Officer (LGPD/CTN).

> **Não feche este incidente sem post-mortem + notificação ao Compliance Officer.** A perda de integridade do audit trail pode comprometer defesas em litígio trabalhista, fiscal (10 anos) e LGPD (Art. 37).

---

## 1. Sintomas observados

- Sentry alerta: `audit chain tampered` com `firstBrokenSeq`, `firstBrokenId`.
- `cron_runs` tem a linha mais recente de `verify-audit-chain` com `status='failed'`, `duration_ms` dentro do normal.
- `audit_chain_checkpoints` pode ter um checkpoint novo _se_ for purge legítimo (ver §5). Caso contrário, é tampering.
- Qualquer INSERT em `audit_logs` continua funcionando (a cadeia cresce a partir do hash corrompido adiante).

---

## 2. Impacto no cliente

- **Nenhum impacto funcional imediato.** O app continua operando.
- Impacto regulatório: audit trail sem garantia de integridade para o período pós-tampering.
- Qualquer investigação jurídica do período afetado precisa explicitar a data/janela do comprometimento.

---

## 3. Primeiros 5 minutos (containment)

1. **Snapshot imediato** (antes de qualquer ação corretiva):
   ```sql
   -- staging ou prod: salve o resultado inteiro em anexo no issue
   SELECT * FROM public.verify_audit_chain('-infinity'::timestamptz, 'infinity'::timestamptz, 1000000);
   ```
2. **Abrir issue no GitHub** com label `incident` + `compliance` + `severity:p1`. Titule: `P1 — audit chain tampered (seq=<X>, run_id=<Y>)`.
3. **Pausar o cron `/api/cron/verify-audit-chain`** somente se o alerta estiver em loop e atrapalhando triagem (via `vercel.json`→Vercel dashboard). Normalmente NÃO é necessário.
4. **NÃO execute nenhum `UPDATE`/`DELETE`/`REASSIGN`** em `audit_logs` — qualquer tentativa adicional corrompe a investigação.

---

## 4. Diagnóstico (queries e logs)

### 4.1 — Identificar a linha quebrada

```sql
-- Primeiro broken seq do cron
SELECT * FROM public.verify_audit_chain(
  now() - interval '48 hours',
  now()
);

-- Diff entre o row_hash armazenado e o recomputado (forense)
WITH target AS (
  SELECT * FROM public.audit_logs WHERE seq = <BROKEN_SEQ>
)
SELECT
  t.id, t.seq, t.created_at, t.entity_type, t.action,
  encode(t.row_hash, 'hex')                              AS stored_hash,
  encode(
    extensions.digest(
      coalesce(t.prev_hash, '\x') ||
      convert_to(public.audit_canonical_payload(t)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )                                                       AS recomputed_hash,
  encode(t.prev_hash, 'hex')                              AS stored_prev,
  encode(
    (SELECT p.row_hash FROM public.audit_logs p WHERE p.seq = t.seq - 1),
    'hex'
  )                                                       AS expected_prev
FROM target t;
```

Interpretação:

- `stored_hash ≠ recomputed_hash` e `stored_prev = expected_prev` → **o conteúdo da linha foi alterado** (UPDATE invisível via bypass da trigger, ou DBA interveniu).
- `stored_prev ≠ expected_prev` → **uma linha anterior sumiu** (DELETE bypass) ou **uma linha foi inserida fora da sequência** (sem trigger).
- Ambos diferentes → ataque multi-step (alteração + remoção).

### 4.2 — Correlacionar com atividade suspeita

```sql
-- Quem tocou audit_logs recentemente? (logs de aplicação via Sentry + server_logs)
SELECT * FROM public.server_logs
 WHERE created_at > (SELECT created_at FROM public.audit_logs WHERE seq = <BROKEN_SEQ>) - interval '10 minutes'
   AND message ILIKE '%audit%'
 ORDER BY created_at DESC
 LIMIT 50;

-- Algum checkpoint novo inesperado?
SELECT * FROM public.audit_chain_checkpoints
 WHERE created_at > now() - interval '7 days'
 ORDER BY id DESC;

-- Todas as triggers no audit_logs ainda estão lá?
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.audit_logs'::regclass AND NOT tgisinternal;
-- Esperado: audit_logs_chain_trg, audit_logs_prevent_update_trg, audit_logs_prevent_delete_trg
-- Se ausentes ou tgenabled='D' → alguém desabilitou.
```

### 4.3 — Confirmar se é falso-positivo (rotação legítima)

A janela padrão do cron é 48 h, enquanto retenção só corre no 1º dia do mês (2 UTC). Ainda assim, confira:

```sql
-- Retenção rodou recentemente?
SELECT id, job_name, started_at, status, result
  FROM public.cron_runs
 WHERE job_name = 'enforce-retention'
   AND started_at > now() - interval '7 days'
 ORDER BY started_at DESC;

-- O checkpoint correspondente ao primeiro seq da janela?
SELECT * FROM public.audit_chain_checkpoints
 WHERE new_genesis_seq = <BROKEN_SEQ>;
```

Se existir checkpoint com `new_genesis_seq = broken_seq` e `reason='retention_purge'` recente, é falso-positivo: o cron não reconheceu o checkpoint (bug). Pule para §7.

---

## 5. Mitigação imediata

1. **Preservar a evidência forense:** exporte `audit_logs`, `audit_chain_checkpoints`, `server_logs` e `cron_runs` para o offsite backup mais próximo (ver `docs/runbooks/database-unavailable.md` §6 para o script). Anexe ao issue.
2. **Isolar credenciais**: se houve DELETE/UPDATE bypass, alguém tem DDL no banco. Rote:
   - `SUPABASE_SERVICE_ROLE_KEY` (reset em Supabase dashboard → Settings → API).
   - `SUPABASE_ACCESS_TOKEN` (Supabase dashboard → Account → Tokens).
   - Qualquer `postgres` role custom que tenha `BYPASSRLS` ou `SUPERUSER`.
3. **Não reconstrua a cadeia** até a investigação terminar. A cadeia quebrada é o _corpus delicti_.

---

## 6. Correção definitiva

Após investigação concluída (RFC com Compliance Officer aprovado):

1. **Se a linha alterada é recuperável** (valor original conhecido):
   - Abrir migration `NNN_audit_restore_seq_<N>.sql` que:
     - Faz backup bruto da linha em `audit_chain_forensics` (tabela criada inline).
     - Reconstrói `row_hash` a partir do valor original (SECURITY DEFINER + GUC).
     - Registra um checkpoint `reason='manual'` com notes contendo o `incident_id`.
   - Aplicar em prod via Management API, revisar com compliance.
2. **Se a linha não é recuperável**:
   - Criar checkpoint `reason='manual'` com `new_genesis_seq` = primeiro seq pós-tampering, `notes` contendo link para o post-mortem.
   - O verifier vai aceitar esse ponto como novo genesis e a cadeia volta a ser verificável a partir dali.
3. **Re-executar `verify_audit_chain('-infinity','infinity')`** e anexar o resultado ao issue antes de fechar.

---

## 7. Se for falso-positivo (checkpoint não reconhecido)

1. Verificar que o checkpoint existe:
   ```sql
   SELECT * FROM public.audit_chain_checkpoints WHERE new_genesis_seq = <BROKEN_SEQ>;
   ```
2. Se existir mas o verifier ainda falha, é bug em `verify_audit_chain`. Abrir PR com:
   - Teste em `tests/unit/api/verify-audit-chain.test.ts` reproduzindo o cenário.
   - Ajuste na função SQL.
3. Enquanto corrige, o cron pode ser silenciado via env `AUDIT_CHAIN_VERIFY_LOOKBACK_HOURS=0` (Vercel → Project → Environment Variables). **Máximo 48h de silenciamento**; abrir alarme manual se exceder.

---

## 8. Post-incident (≤ 72 h)

1. **Post-mortem**: template em `.github/ISSUE_TEMPLATE/postmortem.md`. Incluir timeline em UTC.
2. **Notificar Compliance Officer** e, se houver dado pessoal exposto indiretamente, preparar comunicação à ANPD (LGPD Art. 48) — prazo de 2 dias corridos.
3. **Abrir follow-ups:**
   - Reduzir `AUDIT_CHAIN_VERIFY_LOOKBACK_HOURS` se a janela foi insuficiente para detectar a tempo.
   - Revisar roles com `BYPASSRLS`/`SUPERUSER` (`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles`).
   - Validar que `migration 046` foi reaplicada se alguém dropou triggers.
4. **Rodar drill de restore** (`docs/runbooks/database-unavailable.md`) para garantir o backup offsite cobre o período afetado.

---

## 9. Links úteis

- Migration: `supabase/migrations/046_audit_hash_chain.sql`
- Cron: `app/api/cron/verify-audit-chain/route.ts`
- RPC: `public.verify_audit_chain(start, end, max_rows)`
- Checkpoint table: `public.audit_chain_checkpoints`
- Dashboard Sentry (proj clinipharma): filtro `module:cron/verify-audit-chain`.
- Supabase SQL Editor: https://supabase.com/dashboard/project/jomdntqlgrupvhrqoyai/sql/new
