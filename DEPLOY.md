# MedAxis — Guia de Deploy

## Pré-requisitos

- Conta no [Supabase](https://supabase.com) com projeto criado
- Conta no [Vercel](https://vercel.com)
- Repositório no GitHub: https://github.com/cabralandre82/MedAxis
- Node.js 20+

---

## 1. Subir código para o GitHub

```bash
cd b2b-med-platform
git remote add origin https://github.com/cabralandre82/MedAxis.git
git branch -M main
git push -u origin main
```

---

## 2. Configurar Supabase

Ver `docs/setup-supabase.md` para instruções detalhadas.

Resumo:

1. Acesse o [Supabase Dashboard](https://app.supabase.com)
2. Abra o projeto `jomdntqlgrupvhrqoyai`
3. Vá em **SQL Editor**
4. Execute cada arquivo de `supabase/migrations/` em ordem numérica
5. Execute `supabase/seed/seed.sql` para dados de desenvolvimento
6. Crie os Storage Buckets: `product-images` e `order-documents`

---

## 3. Deploy na Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login
2. Clique em **Add New Project**
3. Importe o repositório `cabralandre82/MedAxis`
4. Configure as variáveis de ambiente:

```
NEXT_PUBLIC_SUPABASE_URL=https://jomdntqlgrupvhrqoyai.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<sua_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<sua_service_role_key>
NEXT_PUBLIC_APP_URL=https://seu-dominio.vercel.app
NEXT_PUBLIC_APP_NAME=MedAxis
```

5. Clique em **Deploy**

---

## 4. Configurar URL de callback do Supabase Auth

Após o primeiro deploy, copie a URL da Vercel (ex: `https://medaxis.vercel.app`) e:

1. Acesse o Supabase Dashboard → **Authentication → URL Configuration**
2. Defina:
   - **Site URL**: `https://medaxis.vercel.app`
   - **Redirect URLs**: `https://medaxis.vercel.app/auth/callback`

---

## 5. Domínio personalizado (opcional)

Na Vercel, vá em **Settings → Domains** e adicione seu domínio.
Atualize o Site URL no Supabase com o novo domínio.

---

## Configurações de produção importantes

- Habilite **Email confirmations** no Supabase Auth
- Desabilite **Allow new users to sign up** se quiser cadastro apenas por convite
- Configure **SMTP** no Supabase para emails transacionais
- Revise as políticas RLS antes do go-live

Ver `docs/go-live-checklist.md` para a lista completa.
