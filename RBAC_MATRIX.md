# MedAxis — Matriz de Permissões (RBAC)

## Papéis

| Papel            | Descrição                                                 |
| ---------------- | --------------------------------------------------------- |
| `SUPER_ADMIN`    | Acesso total, configurações globais, auditoria completa   |
| `PLATFORM_ADMIN` | Operação diária: catálogo, pedidos, financeiro, entidades |
| `CLINIC_ADMIN`   | Gerencia sua clínica, cria pedidos, acompanha financeiro  |
| `DOCTOR`         | Cria pedidos, anexa documentos, acompanha status          |
| `PHARMACY_ADMIN` | Executa pedidos, atualiza status, vê repasses             |

---

## Módulo: Clínicas

| Ação            | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN |
| --------------- | :---------: | :------------: | :----------: | :----: | :------------: |
| Listar todas    |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Ver própria     |     ✅      |       ✅       |      ✅      |   ✅   |       ❌       |
| Criar           |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Editar          |     ✅      |       ✅       | ✅ (própria) |   ❌   |       ❌       |
| Bloquear/Ativar |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |

## Módulo: Médicos

| Ação            | SUPER_ADMIN | PLATFORM_ADMIN |  CLINIC_ADMIN   |    DOCTOR    | PHARMACY_ADMIN |
| --------------- | :---------: | :------------: | :-------------: | :----------: | :------------: |
| Listar todos    |     ✅      |       ✅       | ✅ (vinculados) |      ❌      |       ❌       |
| Ver perfil      |     ✅      |       ✅       | ✅ (vinculados) | ✅ (próprio) |       ❌       |
| Criar           |     ✅      |       ✅       |       ❌        |      ❌      |       ❌       |
| Editar          |     ✅      |       ✅       |       ❌        | ✅ (próprio) |       ❌       |
| Bloquear/Ativar |     ✅      |       ✅       |       ❌        |      ❌      |       ❌       |

## Módulo: Farmácias

| Ação            | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN |
| --------------- | :---------: | :------------: | :----------: | :----: | :------------: |
| Listar todas    |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Ver própria     |     ✅      |       ✅       |      ❌      |   ❌   |       ✅       |
| Criar           |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Editar          |     ✅      |       ✅       |      ❌      |   ❌   |  ✅ (própria)  |
| Bloquear/Ativar |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |

## Módulo: Produtos / Catálogo

| Ação                   | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN |
| ---------------------- | :---------: | :------------: | :----------: | :----: | :------------: |
| Visualizar catálogo    |     ✅      |       ✅       |      ✅      |   ✅   |       ✅       |
| Criar produto          |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Editar produto         |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Alterar preço          |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Upload imagem          |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Ver histórico de preço |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |

## Módulo: Pedidos

| Ação              | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN |    DOCTOR    |  PHARMACY_ADMIN  |
| ----------------- | :---------: | :------------: | :----------: | :----------: | :--------------: |
| Listar todos      |     ✅      |       ✅       |      ❌      |      ❌      |        ❌        |
| Listar próprios   |     ✅      |       ✅       | ✅ (clínica) |  ✅ (seus)   |  ✅ (farmácia)   |
| Criar pedido      |     ✅      |       ✅       |      ✅      |      ✅      |        ❌        |
| Upload documentos |     ✅      |       ✅       |      ✅      |      ✅      |        ❌        |
| Cancelar          |     ✅      |       ✅       | ✅ (próprio) | ✅ (próprio) |        ❌        |
| Mudar status      |     ✅      |       ✅       |      ❌      |      ❌      | ✅ (operacional) |

## Módulo: Pagamentos

| Ação                 | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN |
| -------------------- | :---------: | :------------: | :----------: | :----: | :------------: |
| Ver todos pagamentos |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Ver próprios         |     ✅      |       ✅       |      ✅      |   ✅   |       ❌       |
| Confirmar pagamento  |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Anexar comprovante   |     ✅      |       ✅       |      ✅      |   ✅   |       ❌       |

## Módulo: Repasses

| Ação              | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN |
| ----------------- | :---------: | :------------: | :----------: | :----: | :------------: |
| Ver todos         |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Ver próprios      |     ✅      |       ✅       |      ❌      |   ❌   |       ✅       |
| Registrar repasse |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
| Calcular comissão |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |

## Módulo: Auditoria

| Ação              | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN |
| ----------------- | :---------: | :------------: | :----------: | :----: | :------------: |
| Ver todos os logs |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |

## Módulo: Configurações

| Ação                         | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN |
| ---------------------------- | :---------: | :------------: | :----------: | :----: | :------------: |
| Editar configurações globais |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |
| Ver configurações            |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |
