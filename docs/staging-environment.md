# Clinipharma — Staging Environment

## Objetivo

Ambiente isolado de staging para validar deploys antes de ir para produção, sem afetar dados reais.

## Política

- **Nunca testar fluxos destrutivos em produção** (ex: cancelamento de pedidos em massa, reset de dados)
- Todo deploy vai primeiro para staging → QA → produção
- Credenciais de staging são sempre de teste (Asaas Sandbox, Clicksign Sandbox, Twilio Test)

## Setup (a fazer)

### 1. Supabase — Projeto de Staging

1. Criar novo projeto Supabase: `clinipharma-staging`
2. Aplicar todas as migrations: `supabase db push --db-url <staging_db_url>`
3. Rodar seed de dados de teste: `npx tsx scripts/setup-production.ts`
4. Configurar variáveis de ambiente de staging (ver abaixo)

### 2. Vercel — Environment de Staging

1. No painel Vercel → Settings → Environment Variables
2. Adicionar variáveis com escopo **Preview** (não Production)
3. Ou criar projeto Vercel separado `clinipharma-staging`
4. Configurar deploy automático do branch `staging` → staging environment

### 3. Branch Strategy

```
main ──────────────────────────────── production (clinipharma.com.br)
  └── staging ─────────────────────── staging (staging.clinipharma.com.br)
        └── feature/* ─────────────── preview deployments
```

### 4. Variáveis de Ambiente de Staging

| Variável                    | Valor de Staging                     |
| --------------------------- | ------------------------------------ |
| `SUPABASE_URL`              | URL do projeto staging               |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave do projeto staging             |
| `ASAAS_API_KEY`             | Chave de **Sandbox** Asaas           |
| `ASAAS_BASE_URL`            | `https://sandbox.asaas.com/api/v3`   |
| `CLICKSIGN_TOKEN`           | Token de **Sandbox** Clicksign       |
| `CLICKSIGN_BASE_URL`        | `https://sandbox.clicksign.com`      |
| `NEXT_PUBLIC_APP_URL`       | `https://staging.clinipharma.com.br` |

### 5. Dados de Teste (Seed)

```bash
# Rodar após configurar banco de staging
SUPABASE_URL=<staging_url> \
SUPABASE_SERVICE_ROLE_KEY=<staging_key> \
npx tsx scripts/setup-production.ts
```

O seed cria:

- 1 usuário Super Admin (`staging@clinipharma.com.br`)
- 1 farmácia de teste
- 10 produtos de teste
- 1 clínica de teste
- 1 médico de teste

## Checklist de Provisionamento (a fazer)

> **Prioridade:** Fazer antes do primeiro go-live comercial com clientes reais.

### Passo a Passo

```bash
# 1. Criar projeto Supabase staging em https://supabase.com/dashboard
#    Nome sugerido: clinipharma-staging
#    Região: sa-east-1 (São Paulo) — mesma da produção

# 2. Copiar credenciais do projeto staging para um arquivo temporário
STAGING_DB_URL="postgresql://postgres:<senha>@db.<ref-staging>.supabase.co:5432/postgres"
STAGING_SUPABASE_URL="https://<ref-staging>.supabase.co"
STAGING_ANON_KEY="eyJ..."
STAGING_SERVICE_KEY="eyJ..."

# 3. Aplicar migrations em staging
cd /home/usuario/b2b-med-platform
npx supabase db push --db-url "$STAGING_DB_URL"

# 4. Rodar seed de dados de teste
SUPABASE_URL="$STAGING_SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$STAGING_SERVICE_KEY" \
npx tsx scripts/setup-production.ts

# 5. Criar branch staging no repositório
git checkout -b staging main
git push origin staging

# 6. No Vercel: Settings → Git → configurar branch "staging" → Environment "Preview"
#    Adicionar variáveis de ambiente de staging no scope Preview
```

### Variáveis de Ambiente a Adicionar no Vercel (scope: Preview, branch: staging)

| Variável                        | Observação                                                 |
| ------------------------------- | ---------------------------------------------------------- |
| `SUPABASE_URL`                  | URL do projeto **staging**                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL do projeto **staging**                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Chave do projeto **staging**                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon do projeto **staging**                          |
| `ASAAS_API_KEY`                 | Chave **Sandbox** Asaas                                    |
| `ASAAS_BASE_URL`                | `https://sandbox.asaas.com/api/v3`                         |
| `CLICKSIGN_TOKEN`               | Token **Sandbox** Clicksign                                |
| `NEXT_PUBLIC_APP_URL`           | `https://staging.clinipharma.com.br` ou URL preview Vercel |

> As demais variáveis (Sentry, Resend, Inngest, Firebase) podem ser reutilizadas do ambiente de produção/preview atual.

## Status

- [ ] Projeto Supabase `clinipharma-staging` criado
- [ ] Migrations `001–022` aplicadas em staging
- [ ] Seed de dados de teste executado
- [ ] Branch `staging` criada no repositório
- [ ] Deploy automático branch `staging` configurado no Vercel
- [ ] Variáveis de ambiente de staging adicionadas no Vercel (scope Preview)
- [ ] Domínio `staging.clinipharma.com.br` configurado (opcional)

## Política de Promção

```
feature branch → PR → code review → merge em staging → QA em staging → merge em main → produção
```

_Nenhuma mudança vai direto para main sem passar por staging._
