# Clinipharma — Limitações Conhecidas do MVP

## Financeiro

- **Sem gateway de pagamento automático**: confirmação de pagamento é manual pelo admin
- **Sem emissão fiscal**: NF-e/NFS-e não integrada
- **Sem split de pagamento automático**: repasse é registrado manualmente

## Autenticação

- **Recuperação de senha via rota própria**: usa `admin.generateLink()` + Resend diretamente. O SMTP do Supabase Auth não está configurado (tentativa falhou silenciosamente; Auth Hook HTTPS também não disparava). A solução atual é robusta e funciona em produção.
- **Google OAuth preparado mas não ativado**: precisa de configuração manual no Google Cloud Console
- **Sem 2FA**: autenticação em dois fatores não implementada

## Produtos

- **Farmácia não altera produtos diretamente**: toda atualização de catálogo passa pela plataforma
- **Sem variações de produto**: cada SKU é um produto separado
- **Produto indisponível sem estoque real**: o status `unavailable` é gerenciado manualmente pelo SUPER_ADMIN; não há integração com estoque de farmácias

## Pedidos

- **Todos os produtos do pedido devem ser da mesma farmácia**: o carrinho bloqueia a mistura de farmácias para garantir um único repasse por pedido
- **Sem estimativa de frete**: prazo é o estimado pela farmácia no cadastro do produto

## Notificações

- **Sem notificações push ou SMS**: apenas notificações in-app e emails transacionais
- **Sem preferências de notificação por usuário**: todas as notificações chegam para o papel inteiro, sem controle individual de quais tipos receber
- **Sem alertas de pedidos parados**: não há mecanismo automático para detectar pedidos sem movimentação por X dias

## Mobile

- **Web apenas**: não existe app mobile no MVP
- **Responsivo**: a interface funciona em mobile, mas é otimizada para desktop

## Relatórios

- **Sem BI avançado**: gráficos são CSS puro (barras) sem biblioteca de charts interativa (Recharts/Chart.js)
- **Sem filtro de período em relatórios**: a página de relatórios exibe totais acumulados sem corte por data
- **Exportação sem filtro de período**: CSV/Excel baixa todos os registros históricos sem filtro por mês/intervalo

## Integrações futuras planejadas

- Gateway de pagamento (Stripe, PagSeguro, Asaas)
- Emissão fiscal (NF-e/NFS-e)
- Assinatura eletrônica de documentos
- Notificações push / SMS / WhatsApp
- App mobile
- Integração com ERP de farmácias
- Gráficos interativos (Recharts ou Chart.js)
- Filtro de período em relatórios e exportações
