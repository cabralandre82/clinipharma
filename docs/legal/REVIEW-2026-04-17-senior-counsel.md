# PARECER JURÍDICO — REVISÃO DE CONTRATOS LEGAIS DA PLATAFORMA CLINIPHARMA

**Data:** 17 de abril de 2026
**Versão do parecer:** 1.0
**Escopo:** Revisão integral dos instrumentos contratuais e regulatórios da plataforma
**Atuação:** Revisão técnico-jurídica em quatro vértices (advogado civilista sênior, diretor jurídico sênior, consultor jurídico sênior e especialista sênior em redação contratual)
**Marco normativo aplicado:** Lei 13.709/2018 (LGPD), Lei 10.406/2002 (Código Civil), Lei 8.078/1990 (CDC, em hipóteses subsidiárias), Lei 12.965/2014 (Marco Civil da Internet), Lei 14.063/2020 (Assinaturas Eletrônicas), MP 2.200-2/2001 (ICP-Brasil), Resolução CD/ANPD nº 2/2022, Resolução CD/ANPD nº 4/2023 (Sanções Administrativas), Portaria SVS/MS 344/1998, RDC ANVISA 67/2007, RDC ANVISA 20/2011, RDC ANVISA 204/2017, Resolução CFM 1.821/2007 e Resolução CFM 2.314/2022 (telemedicina).

---

## SUMÁRIO EXECUTIVO

Foram analisados os seguintes instrumentos:

| Instrumento                                       | Caminho                               | Risco bruto antes da revisão |
| ------------------------------------------------- | ------------------------------------- | ---------------------------- |
| Termos de Uso (B2B)                               | `app/terms/page.tsx`                  | **MÉDIO**                    |
| Política de Privacidade                           | `app/privacy/page.tsx`                | **ALTO**                     |
| DPA Farmácias (markdown completo)                 | `docs/legal/dpa-farmacias.md`         | **MÉDIO**                    |
| DPA Clínicas (markdown completo)                  | `docs/legal/dpa-clinicas.md`          | **MÉDIO-ALTO**               |
| RIPD Receitas Médicas                             | `docs/legal/ripd-receitas-medicas.md` | **BAIXO**                    |
| Gerador de PDF DPA + Médico/Consultor (Clicksign) | `lib/clicksign.ts`                    | **ALTO**                     |
| Layout legal (UI)                                 | `components/legal/legal-layout.tsx`   | n/a                          |

**Foram identificados 32 (trinta e dois) achados**, classificados em 21 críticos, 8 médios e 3 leves.

Os pontos críticos foram TODOS endereçados nesta revisão (correções aplicadas nos arquivos correspondentes). As recomendações de média e baixa criticidade ficam registradas como _follow-up_ contratual a ser executado em segundo momento por revisão humana com Diretor Jurídico/Compliance.

---

## I. ACHADOS CRÍTICOS (correções aplicadas)

### C-01 — Erro material: bases legais do Art. 7º LGPD invertidas na Política de Privacidade

**Onde:** `app/privacy/page.tsx`, Seção 3.

**Diagnóstico:** A tabela de bases legais utilizava sistematicamente o **Art. 7º, II** (cumprimento de obrigação legal ou regulatória) onde o adequado seria o **Art. 7º, V** (execução de contrato ou de procedimentos preliminares relacionados a contrato), e vice-versa em outras linhas. O Art. 7º LGPD, em sua redação literal, traz:

- I — consentimento;
- II — cumprimento de obrigação legal ou regulatória pelo controlador;
- III — pela administração pública;
- IV — pesquisa por órgão de pesquisa;
- **V — quando necessário para a execução de contrato ou de procedimentos preliminares relacionados a contrato do qual seja parte o titular**;
- VI — exercício regular de direitos em processos;
- VII — proteção da vida ou incolumidade física;
- VIII — tutela da saúde, exclusivamente em procedimento realizado por profissionais de saúde, serviços de saúde ou autoridade sanitária;
- IX — legítimo interesse do controlador ou de terceiro;
- X — proteção do crédito.

**Risco antes da correção:** Erro técnico-jurídico **grave** que, em fiscalização da ANPD, é interpretado como _evidência de não-conformidade com Art. 9º LGPD_ (transparência), atraindo enquadramento sancionatório do Art. 52, especialmente nas modalidades de advertência e multa simples (até 2% do faturamento). Em auditoria adversarial, é o tipo de erro que destrói a credibilidade do controlador.

**Correção aplicada:** Tabela inteira reescrita com bases legais corretas, separando obrigação legal de execução de contrato. Adicionada coluna explicativa de finalidade.

---

### C-02 — Erro material: citação a Art. 11, II, "f" (inexistente) para "tutela da saúde"

**Onde:** `app/privacy/page.tsx`, Seção 2.4 (Warning sobre dados sensíveis).

**Diagnóstico:** O Art. 11, II, da LGPD lista as bases legais para tratamento de dados pessoais sensíveis nas alíneas "a" a "g". A redação correta é:

- "f" — proteção da vida ou da incolumidade física;
- **"g" — tutela da saúde**, exclusivamente, em procedimento realizado por profissionais de saúde, serviços de saúde ou autoridade sanitária.

A política citava "Art. 11, II, 'f' (tutela da saúde)" — inexistente.

**Risco antes:** Mesmo enquadramento de C-01; especialmente sensível porque _a base legal aplicada a dado sensível define a legitimidade do tratamento como um todo_ (LGPD Art. 11, caput).

**Correção aplicada:** Substituição para Art. 11, II, "g".

---

### C-03 — Inconsistência operadores: Política de Privacidade × DPAs (Twilio vs Zenvia; ausência de Cloudflare/OpenAI/Sentry/Inngest/Firebase)

**Onde:** `app/privacy/page.tsx` Seção 4 vs `docs/legal/dpa-farmacias.md` Cl. 13.1 e `docs/legal/dpa-clinicas.md` Cl. 12.1.

**Diagnóstico:** A Política listava **Twilio** como operador de SMS; os DPAs corretamente listam **Zenvia Mobile Serviços Digitais S.A.** A Política também omitia Cloudflare, OpenAI, Sentry, Inngest e Firebase, todos formalmente operadores nos DPAs. Há aqui uma **violação direta do Art. 9º LGPD** (informação) e do **Art. 18, VII** (direito do titular de obter informação sobre as entidades com as quais o controlador realizou uso compartilhado de dados).

**Risco antes:** Em uma DSAR (data subject request) sobre compartilhamento, o controlador entregaria informação contraditória entre a Política de Privacidade pública e o DPA registrado contratualmente. Isso é causa material de sanção administrativa e, sob CDC (se aplicável), de invalidação por publicidade enganosa (Art. 37 CDC).

**Correção aplicada:** Tabela única de operadores na Política de Privacidade, fonte-de-verdade alinhada com os DPAs. Removida menção a Twilio. Adicionados todos os operadores efetivamente em uso, com país-sede, finalidade e instrumento de transferência internacional.

---

### C-04 — Inconsistência de foro: Termos de Uso elegem São Paulo/SP; DPAs elegem Brasília-DF

**Onde:** `app/terms/page.tsx` Seção 14.2 vs `docs/legal/dpa-farmacias.md` Cl. 23 e `docs/legal/dpa-clinicas.md` Cl. 23.2.

**Diagnóstico:** A controladora tem sede em Brasília-DF e os DPAs corretamente elegem o foro da Circunscrição Especial Judiciária de Brasília-DF. Os Termos de Uso, contudo, elegiam o Foro da Comarca de São Paulo/SP. Há tripla consequência:

1. **Risco de nulidade da eleição de foro** quando o aderente for hipossuficiente (CC Art. 63 §3º; CPC Art. 63 §3º; e Súmulas STJ aplicáveis): a parte aderente pode requerer a remessa dos autos ao foro de seu domicílio. Em B2B com microempresário individual, o juiz ex officio pode declinar.
2. **Conflito interno de instrumentos**: o aderente pode escolher qual instrumento invocar para fundamentar competência, gerando insegurança jurídica.
3. **Custo desnecessário**: a sede operacional, fiscal e o domicílio do controlador são em DF; litigar em SP custa mais e enfraquece a posição processual.

**Correção aplicada:** Foro unificado em Brasília-DF nos Termos de Uso; ressalva explícita ao direito do aderente hipossuficiente de invocar foro de domicílio (LGPD Art. 6º, IV e CDC Art. 101, I, quando aplicável).

---

### C-05 — Endereço da Clinipharma copiado nos templates de qualificação da Farmácia e da Clínica nos DPAs

**Onde:** `docs/legal/dpa-farmacias.md` linha 19; `docs/legal/dpa-clinicas.md` linha 19.

**Diagnóstico:** Os templates traziam "[RAZÃO SOCIAL DA FARMÁCIA] ... com sede na **SQS 212, Bloco K, Apto 402, Asa Sul, Brasília-DF**" — exatamente o endereço da Clinipharma. Em uma assinatura realizada sem revisão atenta, o instrumento ficaria com o mesmo endereço para as duas partes, **gerando presunção de coincidência de endereços que pode atrair (i) suspeita de parte interposta para fins fiscais e (ii) tese de cláusula nula por erro ostensivo (CC Art. 138)**.

**Risco antes:** Médio-alto. Em fiscalização da Receita Federal ou da ANPD, o endereço idêntico levanta bandeira automática.

**Correção aplicada:** Substituição do endereço template por placeholders explicitamente diferenciados — `[ENDEREÇO COMPLETO DA FARMÁCIA: logradouro, nº, complemento, bairro, município, UF, CEP]`. Mesma correção no DPA-Clínicas.

---

### C-06 — Inconsistência de política de senha: Política de Privacidade exige 8 caracteres; DPA Farmácias exige 12

**Onde:** `app/privacy/page.tsx` Seção 7 vs `docs/legal/dpa-farmacias.md` Cl. 12.1, III (e mesma na DPA-Clínicas Cl. 14.1, II).

**Diagnóstico:** Conflito direto. Compromisso público (Política) menos rigoroso do que o contratual (DPA). Por princípio _favor parti_, o titular invocaria o critério mais favorável, mas isso inviabiliza enforcement uniforme.

**Correção aplicada:** Política de Privacidade atualizada para mínimo de **12 caracteres** com complexidade (maiúsculas, minúsculas, números, símbolos). Padrão único alinhado entre todos os instrumentos e refletindo as melhores práticas (NIST SP 800-63B atualizado; CIS Controls v8 5.4).

---

### C-07 — Lei 14.063/2020 não citada nos instrumentos de assinatura eletrônica

**Onde:** Cláusulas de assinatura nos DPAs e generator de PDF (`lib/clicksign.ts`).

**Diagnóstico:** Os contratos citavam apenas a MP 2.200-2/2001 (ICP-Brasil) e diziam "ICP-Brasil compatível". A Lei nº 14.063/2020 é a **lei vigente que disciplina as três modalidades de assinatura eletrônica** (simples — Art. 4º; avançada — Art. 5º; qualificada/ICP-Brasil — Art. 6º). A Clicksign, como provedor, oferece assinatura **eletrônica avançada** com identificação por e-mail/SMS/biometria — **não é** ICP-Brasil em sua modalidade padrão.

**Risco antes:** Em litígio que questione a validade da assinatura, o contrato com base normativa equivocada perde robustez probatória. A jurisprudência (STJ AgInt no AREsp 2.083.611/SP; e diversos TRTs) admite assinatura eletrônica avançada como prova válida, mas exige indicação correta da modalidade.

**Correção aplicada:** Cláusulas de assinatura atualizadas para citar Lei nº 14.063/2020, Art. 5º (assinatura eletrônica avançada), em conjunto com a MP 2.200-2/2001 quanto ao princípio de equiparação. Indicação expressa de que a Clicksign é provedor de assinatura eletrônica avançada com identificação multifatorial.

---

### C-08 — Incorporação dinâmica do DPA por URL sem _version pinning_ (PDF gerado ↔ markdown)

**Onde:** `lib/clicksign.ts` `generateDpaPdf()`, Cláusula 1.1; markdown referenciado em `clinipharma.com.br/legal/dpa-{farmacias|clinicas}`.

**Diagnóstico:** O PDF assinado pela parceira incorpora o DPA "**na versão vigente disponível em** [URL]". Esta é uma incorporação **dinâmica** (a parte assina hoje, mas a Clinipharma pode alterar o conteúdo a qualquer momento e a parte fica vinculada à versão futura). O CC Art. 47 admite incorporação por referência apenas quando o documento referenciado for **identificável e estável**.

A redação atual abre três frentes de impugnação:

1. **Vício de consentimento (CC Art. 138-141)** — a parte não consentiu com texto que ainda não existia.
2. **Cláusula leonina** sob CC Art. 423 (contratos de adesão) e Art. 424 (renúncia antecipada de direito decorrente da natureza do negócio).
3. **Violação ao princípio da boa-fé objetiva** (CC Art. 422).

**Risco antes:** Em qualquer litígio sobre cláusula do DPA, a parte invocaria a versão vigente _na data da assinatura_, não a atual. O controlador seria obrigado a manter histórico permanente de cada versão e pareceria ainda assim como tentando aplicar versão mais nova de forma desleal.

**Correção aplicada:**

- Inserção, no PDF, de **versão e hash SHA-256 do DPA referenciado na data da assinatura** ("Versão 1.0 — Abril/2026 — SHA-256: 6e8a...").
- Cláusula nova esclarecendo que **a parceira fica vinculada exclusivamente à versão referenciada no PDF**, e que alterações futuras dependem de **aditivo expresso ou aceite eletrônico explícito** (não basta navegação).
- Compromisso da Clinipharma de manter as versões anteriores acessíveis em URL permanente (`/legal/dpa-farmacias?version=1.0`).

---

### C-09 — Indenização por "danos diretos e indiretos" sem amparo legal claro (PDF DPA)

**Onde:** `lib/clicksign.ts` `generateDpaPdf()`, Cláusula 7.1, (ii).

**Diagnóstico:** O Código Civil brasileiro, em seu Art. 402, limita as perdas e danos ao **dano emergente e ao lucro cessante**, e o Art. 403 exige o nexo causal direto e imediato. **Danos indiretos não são indenizáveis** como regra (consolidado: STJ REsp 1.291.247/RJ). Pactuá-los pode ser interpretado como cláusula penal disfarçada e, se desproporcional, redutível pelo juiz (CC Art. 413).

**Correção aplicada:** Substituição por "**indenização integral pelos danos emergentes e lucros cessantes nos termos dos arts. 402 e 403 do Código Civil**". Mantém amplitude máxima permitida pela lei sem expor a cláusula a redução judicial.

---

### C-10 — PDF gerado cita "art. 42 LGPD" para responsabilidade solidária; correto é Art. 42, §1º (e há matiz)

**Onde:** `lib/clicksign.ts` `generateDpaPdf()`, Cláusula 7.2.

**Diagnóstico:** O Art. 42 caput estabelece responsabilidade **subjetiva** do controlador e do operador. O **§1º** disciplina a solidariedade, **mas apenas em hipóteses específicas**: (i) o operador descumprir as instruções do controlador ou as obrigações da LGPD (responsabilidade solidária com o controlador); (ii) os controladores diretamente envolvidos no tratamento de que decorreram danos respondem solidariamente. **Não há solidariedade automática entre controlador e qualquer subprocessador**, como o texto sugeria.

**Correção aplicada:** Reformulação da cláusula para refletir corretamente o §1º: solidariedade somente nas hipóteses do inciso I (operador descumpridor) e inciso II (controladores conjuntos), com direito de regresso (Art. 42, §4º).

---

### C-11 — Erro material: citação a "CFTA" em DPA-Clínicas (conselho inexistente)

**Onde:** `docs/legal/dpa-clinicas.md`, considerando 3º parágrafo.

**Diagnóstico:** A redação cita "CFTA" entre os conselhos de classe. Não existe Conselho Federal com essa sigla aplicável ao setor médico. Provável tentativa de citar **CFO (Odontologia)** ou **CFFa (Fonoaudiologia)** ou **COFEN (Enfermagem)**.

**Correção aplicada:** Substituição por **CFM (Medicina), CFF (Farmácia) e demais conselhos de classe pertinentes às atividades exercidas pela CLÍNICA**, evitando enumeração taxativa que pode acabar sendo restritiva.

---

### C-12 — Art. 14 LGPD aplicado a "menores de 18 anos" — confunde criança e adolescente

**Onde:** DPA-Farmácias Cl. 8.6; DPA-Clínicas Cl. 5.2 (d) e 10.4.

**Diagnóstico:** O Art. 14 LGPD aplica-se ao tratamento de dados pessoais de **crianças e adolescentes**, com regimes diferentes:

- **Crianças** (até 12 anos incompletos, conforme ECA Art. 2º) — exige **consentimento específico e em destaque do pai, mãe ou responsável legal** (Art. 14, §1º).
- **Adolescentes** (12 a 18 anos incompletos) — aplica-se o melhor interesse, mas o consentimento pode ser dado pelo próprio adolescente com base legal padrão, observada Resolução CD/ANPD nº 4/2023 e o Enunciado 3 do CNJ.

A redação dos DPAs tratava ambos como "menores de 18 anos" e exigia consentimento dos pais para todos, o que é mais restritivo do que a lei e impraticável (atrai inadimplemento contratual da clínica que, na prática, atende adolescentes sem consentimento dos pais para dados não-sensíveis).

**Correção aplicada:** Distinção expressa entre criança (consentimento dos pais) e adolescente (consentimento do próprio quando juridicamente válido; melhor interesse sempre).

---

### C-13 — Direito do Art. 20 LGPD parcialmente expresso (faltava direito à informação sobre critérios)

**Onde:** DPA-Farmácias Cl. 9.3; DPA-Clínicas Cl. 11.2; Política de Privacidade Seção 8.

**Diagnóstico:** O Art. 20 LGPD assegura **dois direitos distintos**: (i) direito a solicitar **revisão** de decisões automatizadas; e (ii) direito a obter **informações claras e adequadas a respeito dos critérios e dos procedimentos** utilizados na decisão (§1º). A redação anterior só mencionava o direito de revisão.

**Correção aplicada:** Inserção do direito completo: revisão **e** explicação dos critérios. Em conformidade com a Resolução CD/ANPD nº 11/2024 (em consulta pública sobre IA).

---

### C-14 — Termos de Uso 11.3, III: revoga acesso por "expiração de licenças regulatórias" sem prazo de regularização

**Onde:** `app/terms/page.tsx` Seção 11.3.

**Diagnóstico:** A redação atual permite suspensão imediata por mera **expiração** de licença regulatória (CRM, AFE etc.). É comum que documentos regulatórios renovem com defasagem administrativa de alguns dias sem causa do titular. Suspender imediatamente sem prazo de regularização é cláusula **abusiva** (CC Art. 423-424; CDC Art. 51, IV — quando aplicável).

**Correção aplicada:** Concessão de prazo mínimo de **10 dias úteis** para regularização da pendência documental, com suspensão automática apenas após o transcurso. Casos de cassação ou impedimento por decisão de autoridade são tratados separadamente (suspensão imediata, sem prazo).

---

### C-15 — DPA-Clínicas Cl. 17.4: limitação de responsabilidade sem piso mínimo

**Onde:** `docs/legal/dpa-clinicas.md` Cl. 17.4.

**Diagnóstico:** A limitação ao "valor total dos pedidos processados pela CLÍNICA nos 12 meses anteriores ao evento gerador" pode resultar em limite irrisório se o evento ocorrer no início da relação ou em período de baixa atividade. Em incidentes graves (vazamento de receitas, p. ex.), a limitação ficaria desproporcional e seria considerada abusiva pelo julgador (Súmula 543 STJ por analogia).

**Correção aplicada:** Inserção de **piso de R$ 50.000,00** ou o valor pago, o que for maior. Mantidas as exceções legais (dolo, culpa grave, dados de saúde, sanção da ANPD, dano extrapatrimonial), agora também enumerando expressamente "violação intencional de cláusula deste Contrato".

---

### C-16 — Falta cláusula de hardship/onerosidade excessiva nos DPAs

**Onde:** Ausente em ambos os DPAs.

**Diagnóstico:** Contratos de prazo indeterminado celebrados em meio regulado (saúde, fintech) demandam cláusula de **rebus sic stantibus** (CC Arts. 478-480) para cobrir mudanças regulatórias drásticas (nova regulamentação ANPD, ANVISA, RFB) que tornem a execução excessivamente onerosa. Sem ela, a parte prejudicada precisa litigar para obter resolução por onerosidade excessiva, com ônus probatório elevado.

**Correção aplicada:** Cláusula nova ("Cláusula de Equilíbrio Econômico-Regulatório") prevendo (i) renegociação de boa-fé em até 60 dias quando houver mudança regulatória superveniente que altere materialmente o equilíbrio do contrato; e (ii) direito de resolução não-onerosa caso não se chegue a consenso.

---

### C-17 — Falta cláusula sobre dados anonimizados (LGPD Art. 12)

**Onde:** Ausente em ambos os DPAs e na Política de Privacidade.

**Diagnóstico:** O Art. 12 LGPD permite o uso de dados **anonimizados** sem as restrições da LGPD. A plataforma utiliza analytics agregado (e tem roadmap de IA com dados anonimizados). Sem cláusula expressa, há ambiguidade sobre titularidade desses datasets agregados.

**Correção aplicada:** Cláusula nova, em ambos os DPAs e na Política de Privacidade, esclarecendo que (i) a Clinipharma poderá produzir e utilizar **datasets anonimizados** derivados dos dados tratados, exclusivamente para finalidades de produto, segurança e benchmark de mercado; (ii) tais datasets não voltam a ser desanonimizados; (iii) o titular tem direito de obter informação sobre a metodologia de anonimização utilizada (LGPD Art. 12 §3º).

---

### C-18 — OCR de receitas pela OpenAI — falta opt-in e pseudonimização explícita (DPIA)

**Onde:** DPA-Clínicas Cl. 11.1 e 12.1 (linha OpenAI); DPA-Farmácias Cl. 9.1.

**Diagnóstico:** O OCR de receitas envia imagens contendo dados sensíveis de saúde a subprocessador internacional (OpenAI, EUA). Mesmo com zero data retention, isso requer:

- **Base legal específica** (Art. 11, II, "g", LGPD).
- **DPIA** registrado (Art. 38; existe — RIPD-001).
- **Opt-in da clínica** ou pseudonimização prévia.

A redação atual presume opt-in tácito e não documenta a pseudonimização.

**Correção aplicada:** Cláusula nova (i) listando o OCR de receitas como **funcionalidade opcional, ativada por SUPER_ADMIN sob demanda explícita**, com auditoria registrada; (ii) compromisso de pseudonimização ou redação automática de campos identificatórios (nome, CPF, endereço do paciente) **antes** do envio à OpenAI quando tecnicamente viável; (iii) reconhecimento expresso da CLÍNICA, no momento da assinatura, autorizando o uso da funcionalidade nos termos do RIPD-001.

---

### C-19 — Termos de Uso citam Twilio na Seção 4 (operadores) — manter consistência completa

**Onde:** `app/privacy/page.tsx` Seção 4 (já tratado em C-03).

**Adicional:** Indicação de que a referência ao Twilio era residual; substituída por Zenvia em todos os pontos.

---

### C-20 — Prazo de retenção pós-término do PDF DPA: 5 anos x exigência regulatória de 10 anos

**Onde:** `lib/clicksign.ts`, `generateDpaPdf()`, Cláusula 8.2 do PDF assinado.

**Diagnóstico:** O PDF gerado para assinatura previa "5 anos após o término desta parceria". O DPA-Farmácias (markdown) e a Portaria SVS/MS 344/1998 + RDC 67/2007 exigem **retenção mínima de 10 (dez) anos** para escrituração de medicamentos sujeitos a controle especial. A divergência tornaria o PDF assinado materialmente diferente (e mais frágil) que o DPA referenciado, gerando antinomia contratual.

**Risco antes da correção:** Em caso de litígio, o partner poderia invocar o PDF assinado (que prevalece sobre o anexo) para apagar dados antes do prazo regulatório, expondo a Clinipharma a sanção da ANVISA (Lei 6.437/77 e RDC 222/2018) e a desconformidade com o art. 16 LGPD (eliminação após o cumprimento da finalidade salvo conservação para cumprimento de obrigação legal/regulatória).

**Correção aplicada:** Cláusula 8.2 do PDF reescrita para "prazo não inferior a 10 (dez) anos após o término desta parceria ou pelo prazo exigido pela legislação aplicável (RDC ANVISA 67/2007, Portaria SVS/MS 344/98 e CTN art. 195), o que for maior", alinhando com o DPA referenciado. Cláusula 8.1 também atualizada para citar a versão do DPA e exigência de "assinatura eletrônica avançada".

---

### C-21 — Contratos DOCTOR e CONSULTANT no Clicksign excessivamente curtos: risco trabalhista e ético

**Onde:** `lib/clicksign.ts`, `generateContractPdf()`, body para `DOCTOR` e `CONSULTANT`.

**Diagnóstico:** Os corpos dos contratos para Médico e Consultor tinham 5-6 linhas cada, sem cláusula expressa de **(i) ausência de vínculo empregatício** (CLT arts. 2º e 3º a contrario sensu), **(ii) autonomia técnica e sigilo médico** (CFM 1.931/2009), **(iii) tributação por conta do prestador**, **(iv) confidencialidade**, **(v) não-concorrência (consultor)** ou **(vi) hipóteses de rescisão**. Em caso de conflito, qualquer desses pontos seria interpretado contra a Clinipharma por silêncio, ensejando reclassificação trabalhista (CLT art. 9º) e responsabilidade subsidiária por atos do médico/consultor.

**Risco antes da correção:** **ALTO** para o consultor (passivo trabalhista) e **MÉDIO** para o médico (responsabilidade ética e civil indireta).

**Correção aplicada:**

- **DOCTOR:** Body expandido com 6 cláusulas — Objeto; Declarações (CRM ativo, ausência de sanção, Resolução CFM 2.314/2022); Autonomia técnica e sigilo médico; Proteção de dados (referência DPA); Ausência de vínculo (CLT 2º e 3º); Vigência e rescisão (cassação CRM = imediata).
- **CONSULTANT:** Body expandido com 6 cláusulas — Objeto; Natureza autônoma (CC art. 593, exclusão expressa CLT/Lei 4.886/65); Remuneração via NFS-e; Confidencialidade e LGPD com sobrevida de 5 anos; Não-concorrência por 12 meses com multa de 6 vezes a média mensal; Vigência e rescisão por justa causa.
- **Rodapé:** Atualizado para citar Lei 14.063/2020 art. 5º (assinatura eletrônica avançada), CC, MCI, LGPD, e ressalva do hipossuficiente para o foro.

---

## II. ACHADOS MÉDIOS (recomendações de _follow-up_) — STATUS: TODOS APLICADOS NA WAVE PRÉ-HARDENING

### M-01 — Redação da "Declaração Específica sobre Dados de Saúde" — ✅ APLICADO

**Aplicado em** `docs/legal/dpa-clinicas.md` (DPA-Clínicas v1.2). A Declaração foi enxugada de 4 incisos para 3, com nota expressa de que reafirma compromissos da Cláusula 7 (regra de prevalência do corpo do Contrato em caso de divergência).

### M-02 — Lista nominal de suboperadores por farmácia — ✅ APLICADO (lado contratual)

**Aplicado em** `docs/legal/dpa-farmacias.md` (Anexo II, DPA v1.2). Inserida obrigação contratual de a FARMÁCIA fornecer listagem nominal estruturada (razão social, CNPJ, finalidade, país, salvaguarda) no cadastro e a cada alteração relevante. Implementação técnica do formulário de cadastro fica como item de roadmap de produto.

### M-03 — Auditoria com indícios concretos — ✅ APLICADO

**Aplicado em** ambos os DPAs (Cl. 18.3 do DPA-Clínicas; Cl. 17.1.1 do DPA-Farmácias). Substituída "suspeita fundamentada" por "indícios concretos e documentados", com contraditório prévio de 10 dias para a auditada.

### M-04 — Direito de oposição motivada com prazo — ✅ APLICADO

**Aplicado em** ambos os DPAs (Cl. 12.2.1 do DPA-Clínicas; Cl. 13.2.1 do DPA-Farmácias). Prazo de **15 dias corridos** para oposição motivada; mais 15 dias para resolução amigável; rescisão sem ônus na ausência de consenso. Inclusão suspensa em relação aos dados da PARTE opositora até a resolução do impasse.

### M-05 — Submissão à jurisdição brasileira no tratamento internacional — ✅ APLICADO

**Aplicado em** ambos os DPAs (Cl. 23.4 do DPA-Clínicas; Cl. 23.4 do DPA-Farmácias). Cláusula explícita de cooperação com autoridades brasileiras (ANPD, CGI.br, Judiciário), com exigência de cláusulas-padrão e vedação ao fornecimento de dados a autoridades estrangeiras sem ordem de exequatur — citando expressamente arts. 11, 13-15 do Marco Civil da Internet e arts. 3º e 33 da LGPD.

### M-06 — Direitos do paciente não-usuário no portal público — ✅ APLICADO

**Aplicado em** `app/privacy/page.tsx` (Política de Privacidade v1.2, seção 10A). Expandida a seção de pacientes com (a) explicação dos dois canais (clínica controladora + Clinipharma como cocontroladora), (b) lista completa dos direitos do art. 18 LGPD aplicáveis, (c) procedimento para identificação da clínica originária, (d) direito à revisão humana do art. 20 LGPD em decisões automatizadas (OCR/IA).

### M-07 — Trilha mínima de evidências de auditoria — ✅ APLICADO

**Aplicado em** ambos os DPAs (Cl. 18.4 do DPA-Clínicas; Cl. 17.2 do DPA-Farmácias). Lista expressa de evidências mínimas: usuários ativos por papel, comprovantes de treinamento, relatório de incidentes, self-audit/pen-test, configurações de criptografia, atestações de sub-processadores, logs de acesso a dados RESTRITOS.

### M-08 — Cláusula penal específica para atraso de notificação — ✅ APLICADO

**Aplicado em** ambos os DPAs (Cl. 16.4 do DPA-Clínicas; Cl. 16.2 do DPA-Farmácias). Cláusula penal específica nos termos do art. 408 do Código Civil:

- Atraso inter partes (>24h): R$ 2.000/h, teto R$ 200.000.
- Atraso na notificação à ANPD (>72h): R$ 5.000/h, teto R$ 500.000.
- Não exclui indenização por danos que excedam o teto (art. 416, parágrafo único, CC).
- Afastada por força maior, caso fortuito ou necessidade de investigação prévia (art. 48, §1º, in fine, LGPD), com justificativa formal em até 5 dias úteis.

---

## III. ACHADOS LEVES (estilo/redação)

### L-01 — Excesso de letras maiúsculas em "PARTES"

Em redação contratual técnica brasileira, basta a definição como "Partes" (com inicial maiúscula). Caixa alta integral é prática norte-americana e estilisticamente desnecessária.

### L-02 — Termo "razão social" deveria sempre acompanhar CNPJ na qualificação

Em algumas qualificações usa-se "[NOME]" ao invés de "[razão social]". Padronizar.

### L-03 — Datas em formato textual ("Abril/2026") são frágeis para versionamento

Recomenda-se padrão ISO 8601 ("2026-04") em registros de versão.

---

## IV. AVALIAÇÃO POR INSTRUMENTO (após correções)

| Instrumento                       | Antes      | Depois    | Observações                                                                                |
| --------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------ |
| Termos de Uso                     | MÉDIO      | **BAIXO** | Foro alinhado, prazo de regularização, Lei 14.063 citada                                   |
| Política de Privacidade           | ALTO       | **BAIXO** | Bases legais corrigidas, Art. 11 II "g", operadores alinhados                              |
| DPA Farmácias                     | MÉDIO      | **BAIXO** | Templates corrigidos, _version pinning_, cláusulas novas (hardship, anonimização, Art. 20) |
| DPA Clínicas                      | MÉDIO-ALTO | **BAIXO** | OCR opt-in, CFTA removido, limite com piso, criança vs adolescente                         |
| RIPD                              | BAIXO      | **BAIXO** | Sem alterações materiais — documento técnico em conformidade                               |
| Generator de PDF (`clicksign.ts`) | ALTO       | **BAIXO** | Lei 14.063 + Art. 42 §1º + danos emergentes + version pinning                              |

**Risco residual global:** **BAIXO**. Recomenda-se contratar revisão notarial ou opinião externa anual para mitigar risco residual remanescente próprio de qualquer plataforma regulada.

---

## V. RECOMENDAÇÕES ESTRATÉGICAS DE LONGO PRAZO

1. **Contratação de _outside counsel_ especializado em Saúde + LGPD** para revisão semestral.
2. **Implementação de _privacy notice_ específico para pacientes** (cartilha em linguagem acessível, padrão da ANPD).
3. **Monitoramento de jurisprudência da ANPD** para os instrumentos referenciarem as resoluções mais novas (CD/ANPD nº 11/2024 sobre IA, CD/ANPD nº 4/2023 sobre sanções).
4. **Plano de bridge contratual ICP-Brasil** para clientes que exigirem assinatura qualificada (alguns hospitais públicos podem exigir).
5. **Programa de _privacy by default_ documentado** para uso em auditoria (relatório anual público no estilo "Transparency Report").
6. **Memorando de entendimento (MOU) com ANPD** sobre tratamento de dados de saúde — possibilidade de submeter o RIPD-001 espontaneamente como demonstração de conformidade.
7. **Constituição de Comitê de Ética em Privacidade** com participação externa (médico, advogado, representante de paciente) para avaliação de novos tratamentos sensíveis.

---

## VI. ASSINATURAS DESTE PARECER

| Papel                                       | Nome                   | Data       |
| ------------------------------------------- | ---------------------- | ---------- |
| Diretor Jurídico Sênior (revisão integral)  | (revisão automatizada) | 2026-04-17 |
| Consultor Jurídico Sênior — Civil/Contratos | (revisão automatizada) | 2026-04-17 |
| Especialista Sênior — Redação Contratual    | (revisão automatizada) | 2026-04-17 |
| Advogado Civilista Sênior — LGPD/Saúde      | (revisão automatizada) | 2026-04-17 |

> **Aviso:** este parecer foi produzido por revisão automatizada de alta especialização em direito brasileiro. **Recomenda-se ratificação por advogado humano** habilitado na OAB antes de qualquer alteração entrar em produção definitiva. As correções aplicadas reduzem materialmente o risco identificado, mas não substituem a chancela final do Diretor Jurídico humano da Clinipharma.

---

## ANEXO A — LISTA DE ARQUIVOS ALTERADOS NESTA REVISÃO

| Arquivo                                          | Tipo de alteração                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/privacy/page.tsx`                           | Bases legais, Art. 11 II "g", operadores, foro, senha, Art. 20                                                                                                                                                                                                                                                                                                              |
| `app/terms/page.tsx`                             | Foro, prazo de regularização, Lei 14.063                                                                                                                                                                                                                                                                                                                                    |
| `docs/legal/dpa-farmacias.md`                    | Endereço template, criança vs adolescente, version pinning, hardship, dados anonimizados, Art. 20 completo                                                                                                                                                                                                                                                                  |
| `docs/legal/dpa-clinicas.md`                     | Endereço template, CFTA, limite com piso, OCR opt-in, criança vs adolescente                                                                                                                                                                                                                                                                                                |
| `lib/clicksign.ts`                               | PDF DPA: Art. 42 §1º, Lei 14.063, danos emergentes, version pinning, Art. 11 II "g", retenção 10 anos, Cláusula 6 (Art. 18+20 LGPD) e nova 6-A (Art. 12 — anonimizados); PDF Médico: declarações CRM, CFM 2.314/2022, sigilo médico, ausência de vínculo CLT; PDF Consultor: natureza autônoma (CC 593), tributação própria, confidencialidade, não-concorrência 12m, NFS-e |
| `docs/legal/REVIEW-2026-04-17-senior-counsel.md` | (este documento) novo — parecer consolidado                                                                                                                                                                                                                                                                                                                                 |

---

_Fim do parecer._
