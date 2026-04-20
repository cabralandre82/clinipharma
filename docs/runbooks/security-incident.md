# Runbook — Security Incident (Generic)

**Severidade default:** P0 ou P1 — escalar em caso de dúvida.
**Origem:** qualquer evento com indício de comprometimento não enquadrado em runbook específico. Runbooks específicos têm prioridade:

- Chave de criptografia comprometida → [`secret-compromise`](../../.cursor/skills/secret-compromise/SKILL.md)
- Tampering da audit chain → [`audit-chain-tampered.md`](audit-chain-tampered.md)
- RLS bypass → [`rls-violation.md`](rls-violation.md)
- Rate-limit abuse crônico → [`rate-limit-abuse.md`](rate-limit-abuse.md)
- Vazamento confirmado de dados pessoais → [`data-breach-72h.md`](data-breach-72h.md)

**Quando usar este runbook:** o vetor ainda não é claro, ou o incidente é composto (abuse → acesso não autorizado → possível exfil). Serve como entrada-comum que direciona para o runbook específico assim que o vetor é conhecido.

**SLO:**

- Detecção → decisão inicial: **≤ 15 min**.
- Contenção imediata (bloqueio de vetor): **≤ 1h**.
- Comunicação regulatória se for o caso: **3 dias úteis** (LGPD Art. 48).

---

## 1. Sintomas / gatilhos possíveis

- Alerta de ferramenta externa (ZAP baseline, Gitleaks, Dependabot de severidade alta).
- Relato interno ("vi algo estranho nos logs").
- Relato externo (bug bounty, cliente, pesquisador).
- Comportamento anômalo observado em métricas (`rate_limit_denied_total` spike, tráfego de regiões incomuns, `rbac_denied_total` espalhado).
- Comunicação de outro SaaS sobre credencial vazada.

## 2. Impacto potencial

Até o escopo ser conhecido, **assumir o pior caso compatível com o vetor**:

- Acesso não autorizado a dados pessoais → incidente LGPD.
- Injeção de código/payload → integridade da aplicação.
- DoS efetivo → disponibilidade.
- Credencial comprometida → acesso lateral ao stack externo.

## 3. Primeiros 15 minutos

### 3.1 Declarar e comunicar

1. **Declarar incidente P0 ou P1** — quando em dúvida, começar P0 e rebaixar depois. Seguir [`docs/on-call.md`](../on-call.md).
2. **Abrir canal dedicado** do incidente (issue + nota em `docs/security/incidents/<id>/`).
3. **Notificar DPO** se houver qualquer indício de dado pessoal envolvido.
4. **Iniciar timeline** — anotar tudo com timestamps. Futuro pós-mortem e eventual notificação ANPD dependem disso.

### 3.2 Preservar evidência antes de tocar em qualquer coisa

Antes de bloquear, revogar ou reiniciar:

```sql
-- Copiar últimos 30 min de logs estruturados
select * from server_logs
 where ts >= now() - interval '30 minutes'
 order by ts desc;

-- Eventos de webhook recentes
select * from webhook_events
 where created_at >= now() - interval '30 minutes'
 order by created_at desc;

-- Tentativas de RLS bypass / auth
select * from rate_limit_violations
 where created_at >= now() - interval '1 hour'
 order by created_at desc;

-- Audit trail do período
select * from audit_logs
 where created_at >= now() - interval '1 hour'
 order by sequence_num desc
 limit 200;
```

Salvar output em `docs/security/incidents/<id>/evidence/`.

### 3.3 Escolher o vetor de contenção

| Vetor suspeito                    | Ação de contenção imediata                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| Credencial externa vazada         | Rotacionar a credencial (ver [`secret-rotate`](../../.cursor/skills/secret-rotate/SKILL.md)). |
| IP/rede específica                | Bloquear no Vercel Edge Config ou WAF.                                                        |
| Endpoint específico sendo abusado | Aumentar rate-limit ou colocar por trás de feature flag → `false`.                            |
| Usuário comprometido              | Invalidar sessão do usuário + forçar password reset.                                          |
| Plugin/dependência vulnerável     | Rollback do deploy.                                                                           |
| Banco de dados comprometido       | Pausar deployments + invocar [`emergency-restore.md`](emergency-restore.md).                  |

## 4. Diagnóstico — tipificar o incidente

Responder, com evidência:

1. **Qual o vetor de entrada?** (endpoint público, credencial, dependência, insider, vendor...)
2. **Quem foi afetado?** (usuários autenticados, titulares específicos, catálogo inteiro)
3. **Quais dados foram acessados/alterados?** (PII, dados sensíveis de saúde, audit trail, financeiro)
4. **Houve exfiltração?** (volume de dados saindo, logs de CDN/Vercel/Sentry)
5. **Está ativo ou foi contido?**

Uma vez tipificado, **mudar para o runbook específico** se houver. Este runbook continua sendo o índice.

## 5. Mitigação — reduzir blast radius

### 5.1 Se a credencial é interna (nossa)

Seguir o skill [`secret-rotate`](../../.cursor/skills/secret-rotate/SKILL.md) + runbook [`secret-rotation.md`](secret-rotation.md).

Se for `ENCRYPTION_KEY` ou `SUPABASE_JWT_SECRET` → é P0 regulatório; ver [`secret-compromise`](../../.cursor/skills/secret-compromise/SKILL.md).

### 5.2 Se o vetor é um endpoint abusivo

1. Verificar rate-limit atual do endpoint. Reduzir temporariamente (ex.: `apiLimiter` de 60/min → 5/min).
2. Ativar Cloudflare Turnstile (bot challenge) se ainda não está ativo nesse endpoint.
3. Logar cada request suspeito com headers brutos em `server_logs`.

### 5.3 Se há sessões comprometidas

```sql
-- Invalidar sessões de um usuário específico
update auth.sessions set not_after = now() where user_id = '<uuid>';

-- Invalidar todas as sessões (ação grande — impacta todos os usuários)
update auth.sessions set not_after = now();
```

Seguido de: aumentar logs de auth por 72h; monitorar tentativas de re-login.

### 5.4 Se há dados potencialmente exfiltrados

**Acionar [`data-breach-72h.md`](data-breach-72h.md) imediatamente.** Não aguardar confirmação total do escopo — o relógio de 3 dias úteis começa agora.

## 6. Verificação — o incidente está encerrado?

Critérios cumulativos antes de declarar encerrado:

- [ ] Vetor confirmadamente fechado (evidência em código/config).
- [ ] Métricas relevantes normalizadas por ≥ 30 min.
- [ ] Nenhuma evidência de persistência adicional (backdoor, cron alterado, service role key vazada).
- [ ] Audit chain íntegro (`audit_chain_break_total == 0`).
- [ ] RLS canary verde.
- [ ] Backup pós-incidente criado (novo `backup_runs` row).
- [ ] DPO informado se dado pessoal envolvido.

## 7. Comunicação

| Audiência             | Canal                                | Template                                                                            |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Operador + DPO        | Issue + canal interno                | —                                                                                   |
| Clientes autenticados | In-app banner + e-mail (se material) | [`docs/templates/incident-comms.md`](../templates/incident-comms.md) Template 2 e 3 |
| Titulares afetados    | E-mail direto                        | [`docs/templates/breach-notice-holder.md`](../templates/breach-notice-holder.md)    |
| ANPD                  | Sistema CIS (gov.br)                 | [`docs/templates/anpd-incident-notice.md`](../templates/anpd-incident-notice.md)    |
| Página pública status | Texto curto, sem vetor técnico       | [`docs/templates/incident-comms.md`](../templates/incident-comms.md) Template 4     |

## 8. Post-mortem

Abrir em até 3 dias úteis. Template: [`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md).

Além do que está no template, um post-mortem de segurança precisa:

- **Classificação CVSS** se vulnerabilidade técnica identificada.
- **Indicadores de comprometimento (IoCs)** para monitoramento contínuo.
- **Atualização do threat-model** ([`docs/security/threat-model.md`](../security/threat-model.md)).
- **Patch permanente** (não apenas mitigação temporária) com teste de regressão.

## 9. Prevenção

- Adicionar detecção específica (regra Sentry, dashboard Grafana, alerta de métrica).
- Virar o vetor em teste (E2E ou unit) para garantir não-regressão.
- Revisar runbooks adjacentes: será que esse incidente devia ter sido pego por outro runbook?
- Atualizar o `check-invariants.sh` se for possível codificar prevenção ("esse tipo de exposição é falsificável?").

## 10. Anti-patterns

- **Nunca** tentar "esconder" um incidente minimizando a severidade para não precisar notificar a ANPD. Essa decisão é do DPO com base em critérios objetivos, não de gestão da imagem.
- **Nunca** apagar logs/evidência durante contenção. Rotar chaves, bloquear vetores, mas preservar tudo.
- **Nunca** comunicar causa raiz publicamente antes da investigação concluir. Prefere-se precisão tardia a rumor acelerado.
- **Nunca** prosseguir sem DPO no loop quando há PII envolvida.

---

## Referências

- Runbook: [`docs/runbooks/data-breach-72h.md`](data-breach-72h.md).
- Runbook: [`docs/runbooks/audit-chain-tampered.md`](audit-chain-tampered.md).
- Runbook: [`docs/runbooks/rls-violation.md`](rls-violation.md).
- Runbook: [`docs/runbooks/rate-limit-abuse.md`](rate-limit-abuse.md).
- Runbook: [`docs/runbooks/emergency-restore.md`](emergency-restore.md).
- Runbook: [`docs/runbooks/secret-rotation.md`](secret-rotation.md).
- Skill: [`.cursor/skills/secret-compromise/SKILL.md`](../../.cursor/skills/secret-compromise/SKILL.md).
- Skill: [`.cursor/skills/secret-rotate/SKILL.md`](../../.cursor/skills/secret-rotate/SKILL.md).
- Skill: [`.cursor/skills/incident-open/SKILL.md`](../../.cursor/skills/incident-open/SKILL.md).
- Threat model: [`docs/security/threat-model.md`](../security/threat-model.md).
- Protocolo: [`docs/on-call.md`](../on-call.md).
- Compliance: [`docs/compliance/anpd-art-48-notification.md`](../compliance/anpd-art-48-notification.md).
