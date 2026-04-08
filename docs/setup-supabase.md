# Setup do Supabase

## 1. Acessar o projeto

- URL: https://app.supabase.com/project/jomdntqlgrupvhrqoyai
- Dashboard: https://supabase.com/dashboard

## 2. Rodar as migrations

1. Acesse **SQL Editor** no painel do Supabase
2. Execute os arquivos em `supabase/migrations/` na ordem:
   - `001_initial_schema.sql`
   - `002_rls_policies.sql`
   - `003_functions_triggers.sql`
3. Após cada arquivo, verifique se não há erros

## 3. Criar buckets de storage

1. Vá em **Storage** no painel
2. Crie os buckets:
   - `product-images` — público
   - `order-documents` — privado

## 4. Configurar Auth

1. Vá em **Authentication → Providers**
2. Email/senha já está habilitado por padrão
3. Para Google OAuth (opcional):
   - Habilite o provider Google
   - Insira Client ID e Client Secret do Google Cloud Console
   - Configure o callback URL

## 5. Configurar URLs

1. Vá em **Authentication → URL Configuration**
2. Site URL: `http://localhost:3000` (dev) ou sua URL de produção
3. Redirect URLs: adicione `http://localhost:3000/auth/callback`

## 6. Rodar o seed (desenvolvimento)

1. Execute `supabase/seed/seed.sql` no SQL Editor
2. Isso cria usuários de teste, produtos, pedidos, etc.
3. Veja `docs/seed-users.md` para as credenciais de acesso

## 7. Verificar a configuração

Após tudo pronto, acesse `http://localhost:3000` e tente:

- Login com `superadmin@medaxis.com.br` / `MedAxis@2026`
- Verificar se o dashboard carrega
