# Runbook — Data breach (LGPD 72h notification)

**Gravidade:** 🔴 P0 — legal obligation with statutory deadline.
**Alerta de origem:** `rls-canary` P0 + `rls_canary.page_on_violation` ON, OR
manual discovery (support ticket, security disclosure, BugCrowd report, vendor notification).
**SLO:** initial containment < 1 h · ANPD notification decision < 12 h · ANPD formal notice < **72 h** from confirmed awareness.
**Owner:** solo operator → DPO → Jurídico. Compliance Officer for LGPD Art. 48 is the ultimate accountable party.

> **Isso é um runbook regulado.** LGPD Art. 48 obriga a comunicação à ANPD
> em prazo razoável, que a ANPD interpretou em sua Resolução CD/ANPD Nº 15/2024
> como **3 dias úteis** (72 horas em métrica prática). Não feche este
> incidente sem registro formal + decisão documentada sobre notificação.

---

## 0. Companion skills

- [`.cursor/skills/rls-violation-triage/SKILL.md`](../../.cursor/skills/rls-violation-triage/SKILL.md) — se o gatilho foi o canário RLS.
- [`.cursor/skills/audit-chain-verify/SKILL.md`](../../.cursor/skills/audit-chain-verify/SKILL.md) — se a descoberta envolve a cadeia de auditoria.
- [`.cursor/skills/secret-compromise/SKILL.md`](../../.cursor/skills/secret-compromise/SKILL.md) — se veio de leak de credencial.

Use o skill primeiro para o containment; este runbook existe para a camada
regulatória (decisão sobre notificação, prazos, ofício formal).

---

## 1. O que conta como "incidente de segurança com dados pessoais"

LGPD Art. 48 + Resolução CD/ANPD 15/2024 — notificação à ANPD é obrigatória
quando **todos** os três critérios forem verdadeiros:

1. Houve incidente de segurança (acesso não-autorizado, perda, destruição,
   modificação ou divulgação indevida).
2. Envolveu **dados pessoais** (não apenas dados técnicos).
3. Pode acarretar **risco ou dano relevante** aos titulares.

Critério #3 é o que exige julgamento. A Resolução 15/2024 lista presunção
de risco quando envolve:

- Dados sensíveis (saúde — nosso core, CPF, dados biométricos).
- Dados de crianças ou adolescentes.
- Volume significativo de titulares.
- Dados financeiros.
- Credenciais autenticadoras.

**Na Clinipharma, praticamente qualquer vazamento de dados de pacientes
dispara notificação obrigatória** — operamos exclusivamente com dados
sensíveis de saúde.

---

## 2. Impacto no cliente

- **Titulares (pacientes / usuários):** dependendo do escopo, têm direito à
  comunicação direta também (Art. 48 §1º — ANPD pode determinar).
- **Farmácias/clínicas (B2B):** subprocessadores pela LGPD — precisam ser
  informados formalmente se dados sob seu controle foram afetados (Art. 39).
- **Reputacional:** notificação à ANPD entra em registro público após 30d.
- **Financeiro:** multa até 2% do faturamento / R$ 50M por infração
  (Art. 52, II) se notificação for intempestiva ou omissa.

---

## 3. Primeiros 60 minutos (containment + clock start)

### 3.1 — Iniciar o relógio das 72h

O **prazo começa na "confirmação da ocorrência"** — o momento em que
evidência conclusiva é formada, não quando alguém suspeita.

```bash
# 1. Abrir issue com timestamp preciso
gh issue create \
  --title "P0 — Data breach investigation (clock started $(date -u +%FT%TZ))" \
  --label "incident,severity:p0,compliance,lgpd,dpo-notified" \
  --body "Initial signal: <source>
Timestamp of signal: <ISO>
Timestamp of clock start (confirmed awareness): $(date -u +%FT%TZ)
72h deadline: $(date -u -d '+72 hours' +%FT%TZ)"
```

Anote a data/hora exata de confirmação em UTC. Não arredonde, não
interprete liberalmente.

### 3.2 — Containment antes de investigar

Pare o sangramento antes de diagnosticar a ferida:

1. **Isolar o vetor** se conhecido (revogar sessão, bloquear IP, desativar
   integração, girar secret comprometido — ver skill correspondente).
2. **Preservar logs** — snapshot de `audit_logs`, `server_logs`,
   `session_events`, `webhook_events` da janela suspeita:
   ```sql
   copy (
     select * from public.audit_logs
      where created_at between '<start>' and '<end>'
      order by seq
   ) to stdout with csv header;
   ```
3. **Não tentar "undo"** no banco até o escopo estar mapeado — reverter antes
   da investigação pode destruir evidência e piorar o vazamento.

### 3.3 — Notificar stakeholders internos

Mesmo sem decisão ainda sobre ANPD, acione desde já:

| Quem                            | Como                                                     | SLA      |
| ------------------------------- | -------------------------------------------------------- | -------- |
| DPO                             | E-mail `dpo@clinipharma.com.br` + link ao issue          | < 1 h    |
| Jurídico                        | Advogado externo se houver                               | < 2 h    |
| Head of Engineering (= solo op) | Self-notificado via issue                                | imediato |
| CEO / Founder                   | Only if P0 is confirmed — não espalhe pânico cedo demais | < 12 h   |

---

## 4. Diagnóstico — escopo do vazamento

Três perguntas para responder antes de decidir notificação:

### 4.1 — Quais dados foram afetados?

```sql
-- Mapear tabelas tocadas na janela
select table_name, count(*) as rows_affected
  from public.audit_logs
 where created_at between '<start>' and '<end>'
   and action in ('SELECT_LEAK', 'UNAUTHORIZED_READ', 'RLS_BYPASS')
 group by table_name
 order by rows_affected desc;
```

Tabelas sensíveis na Clinipharma (prioridade máxima se aparecerem):

- `prescriptions`, `prescription_items` — dados clínicos
- `patients`, `patient_contacts` — identificadores + CPF
- `orders`, `order_items` — transações de medicamentos
- `documents` — anexos (laudos, receitas digitalizadas)
- `profiles` — e-mail, telefone, endereço

### 4.2 — Quantos titulares?

```sql
-- Contagem de tenants/titulares únicos afetados
select count(distinct subject_id) as titulares_afetados,
       count(distinct tenant_id) as tenants_afetados
  from public.audit_logs
 where created_at between '<start>' and '<end>'
   and action in ('SELECT_LEAK', 'UNAUTHORIZED_READ');
```

### 4.3 — Quem foi o ator?

```sql
-- Identificar actor (se autenticado) ou atributos (se anônimo)
select actor_id, actor_role, count(*) as acoes,
       min(created_at) as primeiro,
       max(created_at) as ultimo
  from public.audit_logs
 where created_at between '<start>' and '<end>'
 group by 1, 2
 order by acoes desc;
```

Se `actor_id` é NULL e há acessos → é anônimo (raspagem externa, bot). Se
`actor_id` pertence a um usuário legítimo → pode ser credencial comprometida,
RLS mal configurada, ou insider.

---

## 5. Decisão: notificar ANPD ou não

### Matriz de decisão

| Dados sensíveis?                 | Volume         | Risco a titulares | Decisão                                |
| -------------------------------- | -------------- | ----------------- | -------------------------------------- |
| Sim (saúde)                      | Qualquer       | Presumido alto    | **Notificar**                          |
| Não                              | < 50 titulares | Baixo             | Documentar internamente, não notificar |
| Credenciais                      | Qualquer       | Alto (fraude)     | **Notificar** + comunicar titulares    |
| Credito/financeiro               | > 10           | Alto (fraude)     | **Notificar**                          |
| Apenas técnicos (logs, métricas) | N/A            | Nulo              | Não notificar                          |

**Na dúvida, notifique.** A penalidade por omissão (Art. 52, II) é muito
maior que o custo reputacional de notificação preventiva. O registro da
ANPD ficou público só após 30 dias, o que dá tempo de executar comunicação
paralela com titulares.

---

## 6. Notificação formal à ANPD

### 6.1 — Canal oficial

- Portal: <https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento>
- Formulário: "Comunicação de incidente de segurança" (versão 2024).
- Exige CNPJ da controladora + dados do DPO + descrição.

### 6.2 — Conteúdo obrigatório (Resolução 15/2024 Art. 5º)

- [ ] Descrição da natureza do incidente.
- [ ] Dados pessoais afetados (categorias).
- [ ] Número aproximado de titulares afetados.
- [ ] Consequências prováveis.
- [ ] Medidas adotadas para remediar.
- [ ] Data/hora do incidente.
- [ ] Data/hora da ciência pelo controlador.
- [ ] Canal para contato do DPO.

### 6.3 — Template interno

Rascunho em [`docs/templates/anpd-incident-notice.md`](../templates/anpd-incident-notice.md)
(criar se não existir — ver sprint de drift closure).

---

## 7. Comunicação aos titulares

Obrigatória quando:

- Dados sensíveis + volume significativo.
- ANPD determinou expressamente.
- Credenciais vazadas (tem que permitir que usuário rotacione senha).

Canal preferencial: e-mail transacional via Resend (temos auditoria de
envio). Template em [`docs/templates/breach-notice-holder.md`](../templates/breach-notice-holder.md).

Conteúdo mínimo:

- O que aconteceu (em português claro, sem jargão).
- Quais dados seus foram afetados.
- O que você deve fazer (e.g., trocar senha).
- Como entrar em contato com o DPO.

---

## 8. Post-mortem obrigatório

Arquivo: `docs/incidents/YYYY-MM-DD-data-breach-<slug>.md`.

Estrutura mínima (usar [`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md)):

- Linha do tempo com timestamps em UTC.
- Causa raiz (5 whys).
- Decisão sobre notificação (e por quê).
- Cópia/link do registro ANPD (protocolo).
- Cópia/link da comunicação aos titulares (amostra).
- Ações preventivas com prazo.

O post-mortem fica arquivado por **10 anos** (prazo de imprescritibilidade
de pretensão reparatória em dano à personalidade, art. 206 CC + LGPD Art. 44).

---

## 9. Anti-patterns

- **Nunca "esperar mais um dia para ter certeza"** após sinal confirmado.
  O relógio conta, e a ANPD exige boa fé.
- **Nunca notificar sem DPO ciente.** O DPO é o interlocutor formal.
- **Nunca prometer aos titulares "nada aconteceu"** se o escopo ainda está
  em investigação. Diga o que sabe.
- **Nunca deletar logs da janela afetada** "para limpar". Preservação é
  parte do dever de prova.
- **Nunca contornar o prazo com "contei mal, só agora confirmei"** se havia
  evidência antes. Relógio da "ciência" não retrocede.

---

## Links

- **LGPD:** Lei 13.709/2018, Art. 46-49.
- **ANPD Resolução CD/ANPD 15/2024** — cronograma e forma de notificação.
- **Internal:**
  - [`docs/security/threat-model.md`](../security/threat-model.md)
  - [`docs/compliance/subprocessors.md`](../compliance/subprocessors.md)
  - [`.cursor/rules/compliance.mdc`](../../.cursor/rules/compliance.mdc)
  - [`.cursor/skills/rls-violation-triage/SKILL.md`](../../.cursor/skills/rls-violation-triage/SKILL.md)
  - [`.cursor/skills/secret-compromise/SKILL.md`](../../.cursor/skills/secret-compromise/SKILL.md)

---

_Owner: DPO (contratado) + solo operator · Última revisão: 2026-04-20_
