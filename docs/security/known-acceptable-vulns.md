# Known Acceptable Vulnerabilities

Vulnerabilidades conhecidas que foram **avaliadas e aceitas** após análise
de exploitability no contexto da plataforma. Cada entrada deve documentar:
data, alerta, contexto, justificativa, mitigações compensatórias, gatilhos
de revisão, dono e próxima revisão.

> Esta lista **não é** um waiver permanente. Toda entrada precisa ter
> data de re-revisão (≤ 90 dias) e ser revisitada quando o upstream
> publicar versão corrigida ou quando o contexto mudar (ex.: passamos a
> usar `AbortSignal` numa chamada que antes não usava).

---

## VULN-001 · `@tootallnate/once` < 3.0.1 (CVE-2026-3449)

| Campo                      | Valor                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| **Data da avaliação**      | 2026-04-18                                                               |
| **Avaliador**              | @cabralandre82                                                           |
| **Dependabot alert**       | [#7](https://github.com/cabralandre82/clinipharma/security/dependabot/7) |
| **Pacote**                 | `@tootallnate/once`                                                      |
| **Versão usada**           | 2.0.0                                                                    |
| **Versão corrigida**       | 3.0.1                                                                    |
| **CVE**                    | CVE-2026-3449                                                            |
| **GHSA**                   | [GHSA-vpq2-c234-7xj6](https://github.com/advisories/GHSA-vpq2-c234-7xj6) |
| **Severidade (CVSS v3.1)** | **3.3 — Low**                                                            |
| **Vetor**                  | `AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`                                    |
| **CWE**                    | CWE-670 (Always-Incorrect Control Flow Implementation)                   |
| **Próxima revisão**        | **2026-07-17** (90 dias) ou release nova de `firebase-admin`             |
| **Status**                 | Dismissed — `tolerable_risk` no Dependabot                               |

### O bug

Promise fica em pending state permanente quando `AbortSignal` é abortado.
Qualquer `await` ou `.then()` na promise trava indefinidamente.

### Caminho da dependência

```
firebase-admin@13.8.0          ← LATEST publicado, sem upgrade disponível
└─ @google-cloud/storage@7.19.0
   └─ teeny-request@9.0.0      ← legado, descontinuado pelo Google
      └─ http-proxy-agent@5.0.0 ← legado (atual upstream: 9.x)
         └─ @tootallnate/once@2.0.0
```

### Por que não há fix automático

- Estamos na **última versão publicada** do `firebase-admin` (13.8.0).
- O Firebase Admin SDK ainda fixa `@google-cloud/storage@7.x`, que ainda
  depende de `teeny-request@9` + `http-proxy-agent@5` (chain legada).
- O upstream Google ainda não atualizou essa chain. Aguardando publicação.

### Análise de exploitability no nosso contexto

| Critério                   | No nosso código                                           |
| -------------------------- | --------------------------------------------------------- |
| **AV:L** (acesso local)    | Sim — não exposto a tráfego externo                       |
| **PR:L** (privilege baixo) | Atacante precisa estar dentro do processo Node            |
| **C:N I:N**                | Zero impacto em confidencialidade/integridade             |
| **A:L** (availability)     | Apenas se `AbortSignal` for usado em chamadas FCM         |
| **Onde usamos**            | `lib/firebase-admin.ts`, `lib/push.ts`                    |
| **Passamos AbortSignal?**  | **Não** — verificado em ambos arquivos em 2026-04-18      |
| **Worst case real**        | Um envio FCM travar até timeout interno do firebase-admin |

### Decisão

**Aceitar e aguardar upstream.** Justificativas:

1. Severity Low (3.3) e **não-explorável** no código atual.
2. Forçar fix via `npm overrides` para `^3.0.1` tem **risco real de quebrar
   push notifications silenciosamente** — `@tootallnate/once@3` mudou a API
   e `http-proxy-agent@5` foi escrito contra a v2.
3. Reescrever push para FCM REST v1 API (eliminando firebase-admin) é uma
   wave separada com escopo próprio.

### Mitigações compensatórias

- ✅ `lib/push.ts` faz envio fire-and-forget com try/catch — uma promise
  travada não derruba a request HTTP que originou o push.
- ✅ Vercel Functions têm timeout máximo de 10s no plano atual; uma
  promise travada num handler é descartada após o timeout.
- ✅ Sentry captura quando push falha (cobertura observability).

### Gatilhos de re-revisão

Re-avaliar imediatamente se **qualquer** condição abaixo for atendida:

- `firebase-admin` publicar versão que upgrade `@google-cloud/storage` para
  uma chain sem `@tootallnate/once@2`.
- Adicionarmos `AbortSignal` em qualquer chamada via `firebase-admin`.
- Severity for reclassificada para High/Critical pelo NVD.
- Aparecer prova de exploit pública para o CVE.

Caso contrário, revisão de rotina em **2026-07-17**.
