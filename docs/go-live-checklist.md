# MedAxis — Checklist de Go-Live

## Banco de Dados

- [ ] Todas as migrations rodadas no projeto Supabase de produção
- [ ] RLS habilitada em todas as tabelas
- [ ] Políticas RLS testadas para cada papel
- [ ] Buckets de Storage criados (`product-images`, `order-documents`)
- [ ] Políticas de Storage configuradas
- [ ] Seed de produção (apenas usuário super admin inicial) rodado

## Autenticação

- [ ] Email/senha funcionando
- [ ] URL de callback configurada no Supabase Auth
- [ ] Email de recuperação de senha funcionando
- [ ] SMTP configurado (se usando email personalizado)

## Variáveis de Ambiente (Vercel)

- [ ] NEXT_PUBLIC_SUPABASE_URL configurada
- [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY configurada
- [ ] SUPABASE_SERVICE_ROLE_KEY configurada
- [ ] NEXT_PUBLIC_APP_URL com URL de produção
- [ ] NEXT_PUBLIC_APP_NAME = MedAxis

## Build e Deploy

- [ ] `npm run build` passa sem erros
- [ ] `npm run lint` passa sem erros
- [ ] Deploy na Vercel bem-sucedido
- [ ] URL de produção acessível

## Funcionalidades críticas

- [ ] Login funciona
- [ ] Catálogo carrega produtos
- [ ] Criação de pedido funciona
- [ ] Upload de documentos funciona
- [ ] Confirmação manual de pagamento funciona
- [ ] Registro de repasse funciona
- [ ] Timeline do pedido aparece corretamente
- [ ] Logs de auditoria sendo gerados

## Segurança

- [ ] `.env.local` NÃO está no repositório
- [ ] Service Role Key NÃO exposta no frontend
- [ ] RLS bloqueia acesso cruzado entre organizações
- [ ] Rotas privadas redirecionam para login se não autenticado

## Onboarding inicial

- [ ] Usuário super admin criado em produção
- [ ] Farmácias cadastradas
- [ ] Produtos cadastrados no catálogo
- [ ] Clínicas onboardadas
- [ ] Médicos vinculados às clínicas
- [ ] Comissão default configurada em `app_settings`
