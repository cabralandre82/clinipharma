# MedAxis

**Plataforma B2B de intermediação médica** entre clínicas, médicos e farmácias parceiras.

## O que é o MedAxis

MedAxis é uma plataforma web fechada (login obrigatório) que conecta:

- **Clínicas** — criam e acompanham pedidos de produtos farmacêuticos
- **Médicos** — solicitam produtos e anexam documentação obrigatória
- **Farmácias parceiras** — recebem pedidos, executam e entregam para clínicas
- **Plataforma administradora** — gerencia tudo, confirma pagamentos, registra repasses

Não existe paciente final no fluxo. Tudo é B2B. A entrega é sempre para a clínica.

## Stack

| Camada       | Tecnologia                         |
| ------------ | ---------------------------------- |
| Frontend     | Next.js 15, TypeScript, App Router |
| UI           | Tailwind CSS v4, shadcn/ui, Lucide |
| Backend/BaaS | Supabase                           |
| Banco        | PostgreSQL (Supabase)              |
| Auth         | Supabase Auth                      |
| Storage      | Supabase Storage                   |
| Validação    | Zod                                |
| Formulários  | React Hook Form                    |
| Tabelas      | TanStack Table                     |
| Estado       | Zustand                            |
| Testes       | Vitest + Playwright                |
| Deploy       | Vercel + Supabase                  |

## Início rápido

```bash
# 1. Clone o repositório
git clone https://github.com/cabralandre82/MedAxis.git
cd MedAxis

# 2. Configure variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com suas credenciais do Supabase

# 3. Instale dependências (requer Node 20+)
npm install

# 4. Rode as migrations no Supabase
# Ver docs/setup-supabase.md

# 5. Rode o projeto
npm run dev
```

## Documentação

| Arquivo                                                  | Conteúdo                 |
| -------------------------------------------------------- | ------------------------ |
| [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)             | Visão geral do produto   |
| [PRD.md](./PRD.md)                                       | Requisitos detalhados    |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                     | Arquitetura técnica      |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)               | Schema do banco de dados |
| [RBAC_MATRIX.md](./RBAC_MATRIX.md)                       | Matriz de permissões     |
| [BUSINESS_RULES.md](./BUSINESS_RULES.md)                 | Regras de negócio        |
| [USER_FLOWS.md](./USER_FLOWS.md)                         | Fluxos do usuário        |
| [DEPLOY.md](./DEPLOY.md)                                 | Guia de deploy           |
| [docs/go-live-checklist.md](./docs/go-live-checklist.md) | Checklist go-live        |

## Scripts disponíveis

```bash
npm run dev          # Servidor de desenvolvimento
npm run build        # Build de produção
npm run lint         # ESLint
npm run format       # Prettier
npm run test         # Vitest (unit)
npm run test:e2e     # Playwright (e2e)
```

## Versão

`0.1.0` — MVP inicial
