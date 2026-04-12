import type { Metadata } from 'next'
import {
  LegalLayout,
  Section,
  Sub,
  P,
  UL,
  Highlight,
  Warning,
} from '@/components/legal/legal-layout'

export const metadata: Metadata = {
  title: 'Política de Privacidade | Clinipharma',
  robots: 'index, follow',
}

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Política de Privacidade"
      version="1.0"
      effectiveDate="08 de abril de 2026"
      updatedDate="08 de abril de 2026"
    >
      <Highlight>
        Esta Política de Privacidade foi elaborada em conformidade com a Lei Geral de Proteção de
        Dados Pessoais (Lei nº 13.709/2018 — LGPD), o Marco Civil da Internet (Lei nº 12.965/2014),
        a Resolução da Diretoria Colegiada ANVISA nº 204/2017 e demais normas regulatórias
        aplicáveis ao setor farmacêutico e de saúde no Brasil.
      </Highlight>

      {/* 1 */}
      <Section title="1. Identificação do Controlador">
        <P>
          A <strong>Clinipharma</strong> é uma plataforma B2B de intermediação entre clínicas
          médicas, médicos prescritores e farmácias de manipulação, operada por pessoa jurídica
          constituída sob as leis do Brasil (<strong>&ldquo;Clinipharma&rdquo;</strong>,{' '}
          <strong>&ldquo;nós&rdquo;</strong> ou <strong>&ldquo;Controlador&rdquo;</strong>).
        </P>
        <P>
          Para exercer seus direitos como titular de dados ou entrar em contato com nosso
          Encarregado de Proteção de Dados (DPO), utilize:
        </P>
        <UL
          items={[
            'E-mail: privacidade@clinipharma.com.br',
            'Prazo de resposta: até 15 dias corridos (LGPD Art. 19)',
          ]}
        />
      </Section>

      {/* 2 */}
      <Section title="2. Dados Pessoais que Coletamos">
        <Sub title="2.1 Dados de identificação e cadastro">
          <UL
            items={[
              'Nome completo e razão social',
              'CPF e/ou CNPJ',
              'Endereço de e-mail (login e comunicações)',
              'Número de telefone e celular (criptografado em repouso — AES-256-GCM)',
              'Número do CRM/CRF com UF (para médicos e farmacêuticos — criptografado)',
              'Endereço completo (logradouro, CEP, cidade, estado)',
            ]}
          />
        </Sub>

        <Sub title="2.2 Dados de uso da plataforma">
          <UL
            items={[
              'Registros de acesso: IP, data, hora, duração de sessão (Marco Civil da Internet, Art. 15)',
              'Histórico de pedidos, orçamentos e rastreabilidade de entrega',
              'Ações realizadas na plataforma (logs de auditoria imutáveis)',
              'Preferências de notificação',
              'Dispositivo, navegador e sistema operacional (para segurança e suporte)',
            ]}
          />
        </Sub>

        <Sub title="2.3 Dados financeiros">
          <UL
            items={[
              'Dados de cobrança e formas de pagamento (processados pelo Asaas — PCI DSS Level 1)',
              'Histórico de transações e comprovantes',
              'Informações bancárias para repasse de comissões (conta, agência, banco)',
            ]}
          />
        </Sub>

        <Sub title="2.4 Dados de documentos e formulários">
          <UL
            items={[
              'Documentos enviados no processo de cadastro (CNES, Alvará, CRF, CRM)',
              'Formulários de solicitação de manipulação (dados do paciente, quando aplicável)',
              'Contratos assinados digitalmente via Clicksign',
            ]}
          />
        </Sub>

        <Warning>
          <strong>Dado sensível:</strong> Informações relacionadas à saúde do paciente eventualmente
          presentes em formulários de manipulação são tratadas com base no Art. 11, II,
          &ldquo;f&rdquo; da LGPD (tutela da saúde) e ficam acessíveis exclusivamente ao médico
          prescritor, à farmácia executante e ao paciente, nunca sendo compartilhadas com terceiros
          para fins comerciais.
        </Warning>
      </Section>

      {/* 3 */}
      <Section title="3. Finalidade e Base Legal do Tratamento">
        <P>
          Tratamos seus dados pessoais com base nas seguintes hipóteses legais previstas no Art. 7º
          da LGPD:
        </P>

        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 font-semibold text-slate-600">
                <th className="px-3 py-2 text-left">Finalidade</th>
                <th className="px-3 py-2 text-left">Base Legal (LGPD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ['Autenticação e controle de acesso', 'Art. 7º, II — execução de contrato'],
                ['Processamento de pedidos e pagamentos', 'Art. 7º, II — execução de contrato'],
                ['Emissão de NF-e/NFS-e', 'Art. 7º, II e V — obrigação legal'],
                ['Contratos digitais (Clicksign)', 'Art. 7º, II — execução de contrato'],
                ['Verificação de CNPJ e situação fiscal', 'Art. 7º, V — obrigação legal'],
                ['Compliance regulatório ANVISA/CFF', 'Art. 7º, II e V — obrigação legal'],
                ['Notificações transacionais (e-mail, SMS)', 'Art. 7º, II — execução de contrato'],
                ['Suporte ao usuário e gestão de tickets', 'Art. 7º, II — execução de contrato'],
                [
                  'Auditoria e logs de acesso',
                  'Art. 7º, V — obrigação legal; Art. 7º, IX — legítimo interesse',
                ],
                ['Análise de desempenho da plataforma', 'Art. 7º, IX — legítimo interesse'],
                ['Prevenção a fraudes', 'Art. 7º, IX — legítimo interesse'],
                ['LGPD: atendimento aos direitos do titular', 'Art. 7º, V — obrigação legal'],
              ].map(([fin, base], i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-3 py-2 text-slate-700">{fin}</td>
                  <td className="px-3 py-2 text-slate-500">{base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <P>
          <strong>Não realizamos</strong> marketing direto, venda de dados a terceiros, perfilamento
          comportamental para publicidade ou decisões automatizadas que produzam efeitos jurídicos
          sem revisão humana.
        </P>
      </Section>

      {/* 4 */}
      <Section title="4. Compartilhamento de Dados">
        <P>
          Compartilhamos dados estritamente na medida necessária para a prestação dos serviços, com
          os seguintes operadores e terceiros:
        </P>
        <UL
          items={[
            'Asaas Pagamentos S.A. — processamento de cobranças e split de pagamentos (PCI DSS)',
            'Clicksign Gestão de Documentos S.A. — assinatura eletrônica com validade jurídica (ICP-Brasil)',
            'Supabase Inc. — banco de dados e autenticação (servidores na região São Paulo / us-east-1, com DPA assinado)',
            'Vercel Inc. — hospedagem e CDN (infraestrutura serverless, DPA assinado)',
            'Resend Inc. — envio de e-mails transacionais',
            'Twilio Inc. — envio de SMS transacionais',
            'Inngest Inc. — processamento de jobs assíncronos (background tasks)',
            'ReceitaWS — consulta de situação cadastral de CNPJs (dados públicos)',
            'Autoridades públicas — mediante ordem judicial ou regulatória (ANVISA, Receita Federal, CFF)',
          ]}
        />
        <P>
          Todos os operadores são contratualmente obrigados a tratar dados pessoais exclusivamente
          conforme nossas instruções, manter medidas de segurança adequadas e não subcontratarem
          terceiros sem nossa autorização prévia por escrito.
        </P>
      </Section>

      {/* 5 */}
      <Section title="5. Transferência Internacional de Dados">
        <P>
          Alguns operadores listados na Seção 4 armazenam ou processam dados fora do Brasil (EUA,
          União Europeia). Adotamos as seguintes garantias:
        </P>
        <UL
          items={[
            'Cláusulas contratuais padrão (Standard Contractual Clauses — SCCs) exigidas pela ANPD',
            'Operadores localizados em países com nível de proteção adequado reconhecido pela ANPD ou pela Comissão Europeia',
            'Data Processing Agreements (DPA) celebrados com cada operador internacional',
          ]}
        />
      </Section>

      {/* 6 */}
      <Section title="6. Retenção e Exclusão de Dados">
        <div className="mt-2 overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 font-semibold text-slate-600">
                <th className="px-3 py-2 text-left">Categoria de dado</th>
                <th className="px-3 py-2 text-left">Prazo de retenção</th>
                <th className="px-3 py-2 text-left">Base legal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ['Dados financeiros e contábeis', '10 anos', 'Lei nº 9.613/98; IN RFB nº 1.757/17'],
                [
                  'Logs de acesso à plataforma',
                  '6 meses (mínimo legal)',
                  'Marco Civil da Internet, Art. 15',
                ],
                ['Logs de auditoria interna', '5 anos', 'Legítimo interesse / compliance'],
                [
                  'Dados de PII (telefone, CRM)',
                  '5 anos após último acesso',
                  'LGPD — proporcionalidade',
                ],
                [
                  'Documentos regulatórios (CNES, Alvará)',
                  '5 anos após vigência',
                  'Resolução ANVISA RDC 204/2017',
                ],
                ['Formulários de manipulação', '10 anos', 'RDC ANVISA nº 67/2007 (Farmácias)'],
                ['Contratos digitais (Clicksign)', '5 anos', 'Código Civil, Art. 205'],
                ['Dados de suporte (tickets)', '2 anos após encerramento', 'Legítimo interesse'],
              ].map(([cat, prazo, base], i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-3 py-2 text-slate-700">{cat}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{prazo}</td>
                  <td className="px-3 py-2 text-slate-500">{base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Findo o prazo legal, os dados são anonimizados ou deletados de forma segura, conforme
          nossa Política de Retenção e Descarte implementada no sistema (job automático mensal).
        </P>
      </Section>

      {/* 7 */}
      <Section title="7. Segurança dos Dados">
        <P>
          Implementamos medidas técnicas e organizacionais compatíveis com o estado da arte e com o
          porte da operação:
        </P>
        <UL
          items={[
            'Criptografia em trânsito: TLS 1.3 em todas as conexões',
            'Criptografia em repouso: AES-256-GCM para dados sensíveis (telefone, CRM, formulários)',
            'Autenticação: JWT com expiração curta + blacklist de tokens revogados',
            'Controle de acesso: RBAC granular com Row Level Security (RLS) no banco de dados',
            'Auditoria: log imutável de todas as ações críticas com X-Request-ID rastreável',
            'Rate limiting: por IP e por usuário em todos os endpoints da API',
            'Monitoramento: alertas de anomalia via Sentry e UptimeRobot',
            'Backups: automáticos pelo Supabase com retenção configurável',
            'Política de senha: mínimo 8 caracteres com reset seguro',
          ]}
        />
        <P>
          Em caso de incidente de segurança que represente risco ou dano relevante aos titulares,
          notificaremos a ANPD e os titulares afetados em até <strong>72 horas</strong> após a
          ciência do incidente, conforme Art. 48 da LGPD.
        </P>
      </Section>

      {/* 8 */}
      <Section title="8. Direitos do Titular de Dados">
        <P>
          Nos termos dos Arts. 17 a 22 da LGPD, você tem os seguintes direitos em relação aos seus
          dados pessoais tratados pela Clinipharma:
        </P>
        <UL
          items={[
            'Confirmação — saber se tratamos seus dados pessoais',
            'Acesso — obter cópia dos dados que mantemos sobre você',
            'Correção — solicitar atualização de dados incompletos, inexatos ou desatualizados',
            'Anonimização, bloqueio ou eliminação — de dados desnecessários ou tratados em desconformidade',
            'Portabilidade — receber seus dados em formato estruturado e interoperável',
            'Eliminação — dos dados tratados com base em consentimento',
            'Informação sobre compartilhamento — saber com quem compartilhamos seus dados',
            'Revogação do consentimento — quando o tratamento for baseado em consentimento',
            'Oposição — ao tratamento baseado em legítimo interesse',
            'Revisão de decisões automatizadas — solicitar revisão humana',
          ]}
        />
        <Highlight>
          Para exercer qualquer desses direitos, acesse o <strong>Portal LGPD</strong> disponível em
          sua conta (menu → Privacidade) ou envie e-mail para{' '}
          <strong>privacidade@clinipharma.com.br</strong>. Responderemos em até{' '}
          <strong>15 dias corridos</strong>.
        </Highlight>
      </Section>

      {/* 9 */}
      <Section title="9. Cookies e Rastreamento">
        <P>
          Utilizamos apenas cookies <strong>estritamente necessários</strong> ao funcionamento da
          plataforma (sessão, segurança CSRF, preferências de idioma). Não utilizamos cookies de
          rastreamento publicitário, pixels de terceiros ou ferramentas de analytics comportamental.
        </P>
        <UL
          items={[
            'sb-access-token / sb-refresh-token — autenticação Supabase (sessão, HttpOnly, Secure, SameSite=Lax)',
            '__vercel_toolbar — apenas em ambiente de desenvolvimento (não enviado à produção)',
          ]}
        />
      </Section>

      {/* 10 */}
      <Section title="10. Dados de Menores de Idade">
        <P>
          A Clinipharma é uma plataforma exclusivamente <strong>B2B</strong>, destinada a pessoas
          jurídicas e profissionais de saúde devidamente habilitados. Não coletamos dados de pessoas
          menores de 18 anos de forma intencional. Caso identifiquemos tal coleta acidental,
          eliminaremos os dados imediatamente.
        </P>
      </Section>

      {/* 11 */}
      <Section title="11. Alterações a Esta Política">
        <P>
          Podemos atualizar esta Política periodicamente para refletir mudanças legais, regulatórias
          ou operacionais. Alterações substanciais serão comunicadas com antecedência mínima de{' '}
          <strong>30 dias</strong> por e-mail e notificação na plataforma. A data de vigência
          constará sempre no cabeçalho deste documento.
        </P>
        <P>
          O uso continuado da plataforma após a entrada em vigor das alterações implica concordância
          com a nova versão. Caso discorde, você pode solicitar o encerramento de sua conta.
        </P>
      </Section>

      {/* 12 */}
      <Section title="12. Contato e DPO">
        <UL
          items={[
            'DPO (Encarregado de Proteção de Dados): privacidade@clinipharma.com.br',
            'Suporte geral: suporte@clinipharma.com.br',
            'Autoridade Nacional de Proteção de Dados (ANPD): www.gov.br/anpd',
          ]}
        />
        <P>
          Se não estiver satisfeito com nossa resposta, você tem o direito de peticionar à{' '}
          <strong>ANPD</strong> (Autoridade Nacional de Proteção de Dados) conforme Art. 18, §1º da
          LGPD.
        </P>
      </Section>

      <div className="mt-8 border-t pt-6 text-xs text-slate-400">
        Clinipharma — Política de Privacidade v1.0 · Vigência: 08/04/2026 · Referências: LGPD (Lei
        nº 13.709/2018), Marco Civil da Internet (Lei nº 12.965/2014), RDC ANVISA nº 67/2007, RDC
        ANVISA nº 204/2017, Código Civil Brasileiro, Lei nº 9.613/1998.
      </div>
    </LegalLayout>
  )
}
