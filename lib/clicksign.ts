import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { withCircuitBreaker } from '@/lib/circuit-breaker'

const BASE_URL = process.env.CLICKSIGN_API_URL ?? 'https://sandbox.clicksign.com/api/v1'
const ACCESS_TOKEN = process.env.CLICKSIGN_ACCESS_TOKEN ?? ''

async function clicksignFetchRaw<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}?access_token=${ACCESS_TOKEN}`
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Clicksign error ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function clicksignFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return withCircuitBreaker(() => clicksignFetchRaw<T>(path, options), { name: 'clicksign' })
}

// ── Document ──────────────────────────────────────────────────────────────────

interface ClicksignDocument {
  document: { key: string; filename: string; status: string }
}

/**
 * Upload a base64-encoded PDF to Clicksign.
 * Returns the document key.
 */
export async function uploadDocument(params: {
  filename: string
  base64Content: string
  deadline?: string // ISO date
}): Promise<string> {
  const result = await clicksignFetch<ClicksignDocument>('/documents', {
    method: 'POST',
    body: JSON.stringify({
      document: {
        path: `/${params.filename}`,
        content_base64: `data:application/pdf;base64,${params.base64Content}`,
        deadline_at: params.deadline,
        auto_close: true,
        locale: 'pt-BR',
        sequence_enabled: false,
      },
    }),
  })
  return result.document.key
}

// ── Signer ────────────────────────────────────────────────────────────────────

interface ClicksignSigner {
  signer: { key: string }
}

/** Add a signer to a document. Returns the signer key. */
export async function addSigner(params: {
  documentKey: string
  email: string
  name: string
  cpf?: string
  hasMobileApp?: boolean
  selfie?: boolean
}): Promise<string> {
  // Create signer
  const signerResult = await clicksignFetch<ClicksignSigner>('/signers', {
    method: 'POST',
    body: JSON.stringify({
      signer: {
        email: params.email,
        phone_number: '',
        auths: ['email'],
        name: params.name,
        documentation: params.cpf ?? '',
        birthday: '',
        has_documentation: !!params.cpf,
      },
    }),
  })

  const signerKey = signerResult.signer.key

  // Add to document
  await clicksignFetch<unknown>('/lists', {
    method: 'POST',
    body: JSON.stringify({
      list: {
        document_key: params.documentKey,
        signer_key: signerKey,
        sign_as: 'sign',
        refusable: false,
        message: 'Por favor, assine este contrato da Clinipharma.',
      },
    }),
  })

  return signerKey
}

// ── Notify signers ────────────────────────────────────────────────────────────

/** Send signing request emails to all signers of a document. */
export async function notifySigners(documentKey: string): Promise<void> {
  await clicksignFetch<unknown>(`/documents/${documentKey}/notifications`, {
    method: 'POST',
    body: JSON.stringify({ message: 'Seu contrato Clinipharma está pronto para assinatura.' }),
  })
}

// ── PDF generation ────────────────────────────────────────────────────────────

export type ContractType = 'CLINIC' | 'DOCTOR' | 'PHARMACY' | 'CONSULTANT'

interface ContractParty {
  name: string
  cpfCnpj?: string
  email?: string
}

// ── Company constants ─────────────────────────────────────────────────────────

const CLINIPHARMA = {
  razaoSocial: 'ALC INTERMEDIACAO E REPRESENTACAO LTDA',
  cnpj: '66.279.691/0001-12',
  endereco: 'SQS 212, Bloco K, apto 402, Asa Sul, Brasília-DF, CEP 70275-110',
  foro: 'Circunscrição Especial Judiciária de Brasília-DF',
  site: 'clinipharma.com.br',
}

/**
 * Versão atualmente vigente do DPA referenciado por este gerador.
 * Atualizar simultaneamente nos arquivos `docs/legal/dpa-{farmacias,clinicas}.md`.
 *
 * Importante (parecer jurídico 2026-04-17, item C-08): a incorporação por
 * referência exige version pinning explícito para que a parte aderente saiba
 * exatamente qual texto está incorporando, evitando a tese de incorporação
 * dinâmica (LGPD + CC art. 47 + boa-fé objetiva CC art. 422).
 */
const DPA_VERSION = '1.1'
const DPA_VERSION_DATE = '2026-04-17'

// ── PDF layout helpers ────────────────────────────────────────────────────────

interface PageContext {
  doc: PDFDocument
  font: ReturnType<PDFDocument['embedFont']> extends Promise<infer F> ? F : never
  boldFont: ReturnType<PDFDocument['embedFont']> extends Promise<infer F> ? F : never
  pages: ReturnType<PDFDocument['addPage']>[]
  currentPage: ReturnType<PDFDocument['addPage']>
  y: number
  pageNum: number
}

async function createPageContext(doc: PDFDocument): Promise<PageContext> {
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([595, 842])
  return { doc, font, boldFont, pages: [page], currentPage: page, y: 800, pageNum: 1 }
}

function addNewPage(ctx: PageContext): void {
  const page = ctx.doc.addPage([595, 842])
  ctx.pages.push(page)
  ctx.currentPage = page
  ctx.y = 800
  ctx.pageNum++
}

function ensureSpace(ctx: PageContext, needed: number): void {
  if (ctx.y - needed < 60) addNewPage(ctx)
}

function drawText(
  ctx: PageContext,
  text: string,
  opts: {
    size?: number
    bold?: boolean
    color?: ReturnType<typeof rgb>
    x?: number
    indent?: number
  }
): void {
  const size = opts.size ?? 10
  const font = opts.bold ? ctx.boldFont : ctx.font
  const color = opts.color ?? rgb(0.15, 0.15, 0.15)
  const x = opts.x ?? opts.indent ?? 50
  ctx.currentPage.drawText(text, { x, y: ctx.y, font, size, color })
  ctx.y -= size + 5
}

function drawWrappedText(
  ctx: PageContext,
  text: string,
  opts: { size?: number; bold?: boolean; maxWidth?: number; indent?: number; lineSpacing?: number }
): void {
  const size = opts.size ?? 10
  const maxChars = opts.maxWidth ?? 88
  const indent = opts.indent ?? 50
  const lineH = size + (opts.lineSpacing ?? 5)
  const font = opts.bold ? ctx.boldFont : ctx.font

  const words = text.split(' ')
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (test.length > maxChars) {
      ensureSpace(ctx, lineH)
      ctx.currentPage.drawText(line, {
        x: indent,
        y: ctx.y,
        font,
        size,
        color: rgb(0.15, 0.15, 0.15),
      })
      ctx.y -= lineH
      line = word
    } else {
      line = test
    }
  }
  if (line) {
    ensureSpace(ctx, lineH)
    ctx.currentPage.drawText(line, {
      x: indent,
      y: ctx.y,
      font,
      size,
      color: rgb(0.15, 0.15, 0.15),
    })
    ctx.y -= lineH
  }
}

function drawHRule(ctx: PageContext, thickness = 0.5): void {
  ctx.currentPage.drawLine({
    start: { x: 50, y: ctx.y },
    end: { x: 545, y: ctx.y },
    thickness,
    color: rgb(0.8, 0.8, 0.8),
  })
  ctx.y -= 12
}

function drawSection(ctx: PageContext, title: string, body: string[]): void {
  ensureSpace(ctx, 40)
  ctx.y -= 6
  drawText(ctx, title, { bold: true, size: 10, color: rgb(0.07, 0.22, 0.37) })
  ctx.y -= 2
  for (const line of body) {
    if (line === '') {
      ctx.y -= 4
      continue
    }
    drawWrappedText(ctx, line, { indent: 50 })
  }
}

function drawPageNumbers(ctx: PageContext, total: number): void {
  const small = ctx.font
  for (let i = 0; i < ctx.pages.length; i++) {
    ctx.pages[i].drawText(`Página ${i + 1} de ${total}`, {
      x: 480,
      y: 30,
      font: small,
      size: 8,
      color: rgb(0.5, 0.5, 0.5),
    })
  }
}

// ── DPA PDF generation ────────────────────────────────────────────────────────

/**
 * Generate a complete Data Processing Agreement PDF for CLINIC or PHARMACY.
 * Returns base64-encoded PDF.
 */
export async function generateDpaPdf(params: {
  type: 'CLINIC' | 'PHARMACY'
  party: ContractParty
  date?: string
}): Promise<string> {
  const doc = await PDFDocument.create()
  const ctx = await createPageContext(doc)
  const { type, party } = params
  const date = params.date ?? new Date().toLocaleDateString('pt-BR')
  const dpaSlug = type === 'PHARMACY' ? 'dpa-farmacias' : 'dpa-clinicas'
  const dpaUrl = `${CLINIPHARMA.site}/legal/${dpaSlug}?version=${DPA_VERSION}`

  const title =
    type === 'PHARMACY'
      ? 'INSTRUMENTO DE ADESÃO AO ACORDO DE TRATAMENTO DE DADOS (DPA) — FARMÁCIA PARCEIRA'
      : 'INSTRUMENTO DE ADESÃO AO ACORDO DE TRATAMENTO DE DADOS (DPA) — CLÍNICA PARCEIRA'

  const partyRole =
    type === 'PHARMACY' ? 'OPERADOR / CONTROLADOR INDEPENDENTE' : 'CONTROLADOR CONJUNTO'

  // ── Cover ──────────────────────────────────────────────────────────────────
  ctx.currentPage.drawText('CLINIPHARMA', {
    x: 50,
    y: ctx.y,
    font: ctx.boldFont,
    size: 18,
    color: rgb(0.07, 0.22, 0.37),
  })
  ctx.y -= 26

  drawWrappedText(ctx, title, { bold: true, size: 12, maxWidth: 70 })
  ctx.y -= 6
  drawHRule(ctx, 1)
  ctx.y -= 4

  // Parties block
  drawText(ctx, 'PARTES', { bold: true, size: 10, color: rgb(0.07, 0.22, 0.37) })
  ctx.y -= 2

  drawText(ctx, `CONTROLADOR / PLATAFORMA:`, { bold: true, size: 9 })
  drawWrappedText(
    ctx,
    `${CLINIPHARMA.razaoSocial}, CNPJ ${CLINIPHARMA.cnpj}, com sede em ${CLINIPHARMA.endereco} ("Clinipharma").`,
    { indent: 50, size: 9 }
  )
  ctx.y -= 4

  drawText(ctx, `${partyRole}:`, { bold: true, size: 9 })
  const partyDesc = party.cpfCnpj
    ? `${party.name}, CNPJ/CPF ${party.cpfCnpj}${party.email ? `, e-mail ${party.email}` : ''} ("Parceiro").`
    : `${party.name}${party.email ? `, e-mail ${party.email}` : ''} ("Parceiro").`
  drawWrappedText(ctx, partyDesc, { indent: 50, size: 9 })
  ctx.y -= 8

  drawHRule(ctx)

  // ── Clause 1 – Object ──────────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 1 — OBJETO', [
    `1.1. O presente instrumento tem por objeto formalizar a adesão do Parceiro ao Acordo de Tratamento de Dados Pessoais (DPA) da Clinipharma — versão ${DPA_VERSION} de ${DPA_VERSION_DATE} — disponível em ${dpaUrl}, o qual regula o tratamento de dados pessoais realizado no âmbito da utilização da plataforma digital Clinipharma, nos termos da Lei nº 13.709/2018 (LGPD).`,
    '',
    `1.2. O DPA versão ${DPA_VERSION} é parte integrante e indissociável deste instrumento, tendo plena eficácia jurídica como se aqui transcrito estivesse (Código Civil, art. 47).`,
    '',
    `1.3. A incorporação é estática: o Parceiro fica vinculado exclusivamente à versão ${DPA_VERSION} referenciada nesta Cláusula. Eventuais alterações subsequentes do DPA somente produzirão efeitos perante o Parceiro mediante (i) aditivo contratual escrito e assinado eletronicamente, ou (ii) aceite eletrônico expresso após notificação formal com antecedência mínima de 30 (trinta) dias corridos. A simples publicação de nova versão na URL referenciada não substitui esta versão para fins deste instrumento.`,
    '',
    `1.4. A Clinipharma manterá as versões anteriores do DPA acessíveis em URL permanente (formato: clinipharma.com.br/legal/${dpaSlug}?version=X.Y) durante o prazo previsto na Cláusula 8.2, para fins probatórios.`,
  ])

  // ── Clause 2 – Roles ──────────────────────────────────────────────────────
  if (type === 'CLINIC') {
    drawSection(ctx, 'CLÁUSULA 2 — QUALIFICAÇÃO DAS PARTES', [
      '2.1. A Clinipharma e a Clínica Parceira atuam, em relação aos dados pessoais de pacientes inseridos na plataforma para fins de intermediação de pedidos de medicamentos, como CONTROLADORAS CONJUNTAS, nos termos do art. 5º, VI, da LGPD e da orientação interpretativa da ANPD, definindo conjuntamente as finalidades e os meios essenciais do tratamento.',
      '',
      '2.2. A Clínica é a controladora originária dos dados do paciente (nome, data de nascimento, prescrição médica), sendo responsável por possuir base legal válida (consentimento, execução de contrato de prestação de serviços médicos, obrigação legal ou tutela da saúde) e por informar o paciente sobre o compartilhamento dos dados com a Clinipharma e com a farmácia executante (LGPD, art. 9º).',
      '',
      '2.3. A Clinipharma processa esses dados para execução do contrato com o Parceiro (art. 7º, V, LGPD), para cumprimento de obrigações legais (art. 7º, II) e, no que toca a dados de saúde, com fundamento no art. 11, II, "a" (obrigação legal — ANVISA) e no art. 11, II, "g" (tutela da saúde).',
    ])
  } else {
    drawSection(ctx, 'CLÁUSULA 2 — QUALIFICAÇÃO DAS PARTES', [
      '2.1. A Farmácia Parceira atua como OPERADORA (art. 5º, VII, LGPD) em relação aos dados pessoais de pacientes transmitidos pela Clinipharma para fins de processamento e entrega de pedidos.',
      '',
      '2.2. A Farmácia atua adicionalmente como CONTROLADORA INDEPENDENTE em relação aos dados que deve manter por imposição legal regulatória autônoma (ANVISA — RDC 67/2007, Portaria SVS/MS 344/1998 e RDC 20/2011), sem subordinação à Clinipharma para esses fins.',
      '',
      '2.3. A Farmácia somente tratará os dados pessoais dos pacientes nas finalidades estritamente necessárias para executar o pedido e cumprir obrigações regulatórias, sendo vedado qualquer uso secundário sem base legal autônoma e específica.',
    ])
  }

  // ── Clause 3 – Data categories ────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 3 — CATEGORIAS DE DADOS TRATADOS', [
    '3.1. São tratados no âmbito desta parceria:',
    '  (a) DADOS COMUNS: nome, e-mail, telefone, endereço, CNPJ/CPF, dados de faturamento.',
    '  (b) DADOS DE SAÚDE (sensíveis — art. 11 LGPD): prescrições médicas, CRM do prescritor, medicamentos, posologia, diagnóstico quando expresso na receita.',
    '',
    '3.2. O tratamento de dados de saúde baseia-se em:',
    '  • Cumprimento de obrigação legal (art. 11, II, "a", LGPD) — escrituração nos livros de dispensação exigidos pela ANVISA (RDC 67/2007, Portaria 344/98, RDC 20/2011).',
    '  • Tutela da saúde (art. 11, II, "g", LGPD) — exclusivamente em procedimento realizado por profissionais de saúde, serviços de saúde ou autoridade sanitária, para a entrega do medicamento ao paciente.',
    '',
    '3.3. Nenhum dado de saúde será utilizado para fins de marketing, profiling ou inteligência comercial sem base legal autônoma e específica.',
  ])

  // ── Clause 4 – Key obligations ────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 4 — OBRIGAÇÕES DO PARCEIRO', [
    '4.1. O Parceiro compromete-se a:',
    '  (i) Tratar os dados pessoais exclusivamente nas finalidades previstas neste instrumento e no DPA incorporado;',
    '  (ii) Implementar medidas técnicas e organizacionais adequadas (ABNT NBR ISO/IEC 27001) para proteger os dados contra acesso não autorizado, perda, alteração ou divulgação indevida;',
    '  (iii) Notificar a Clinipharma, em até 48 horas, sobre qualquer incidente de segurança que possa afetar dados pessoais tratados nesta parceria;',
    '  (iv) Não subcontratar o tratamento de dados a terceiros sem prévia autorização escrita da Clinipharma;',
    '  (v) Submeter-se a auditorias realizadas pela Clinipharma ou por auditores independentes, mediante aviso prévio de 5 dias úteis;',
    '  (vi) Ao término da parceria, destruir ou devolver, conforme solicitado, todos os dados pessoais, exceto quando a retenção for exigida por lei.',
  ])

  // ── Clause 5 – Security ───────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 5 — SEGURANÇA DA INFORMAÇÃO', [
    '5.1. A Clinipharma implementa os seguintes controles de segurança na plataforma:',
    '  • Criptografia AES-256-GCM em repouso; TLS 1.3 em trânsito.',
    '  • Autenticação JWT com refresh token rotation e revogação por evento.',
    '  • Row Level Security (RLS) no banco de dados — cada entidade acessa apenas seus dados.',
    '  • Rate limiting (100 req/min por IP) e circuit breaker em integrações externas.',
    '  • Logs de auditoria imutáveis com retenção de 5 anos.',
    '',
    '5.2. A IA da plataforma (OpenAI GPT-4o Vision) opera com zero data retention — dados de prescrições não são usados para treinar modelos.',
  ])

  // ── Clause 6 – Data subject rights ───────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 6 — DIREITOS DOS TITULARES', [
    '6.1. Os titulares de dados (pacientes, médicos) poderão exercer todos os direitos previstos no art. 18 da LGPD (confirmação, acesso, correção, anonimização, bloqueio, eliminação, portabilidade, informação sobre compartilhamento, revogação de consentimento, oposição) diretamente pela plataforma ou pelo e-mail privacidade@clinipharma.com.br.',
    '',
    '6.2. Os titulares têm também direito (a) à revisão humana de decisões automatizadas que afetem seus interesses (art. 20, caput, LGPD), e (b) a obter informações claras e adequadas sobre os critérios e procedimentos utilizados em tais decisões automatizadas (art. 20, §1º, LGPD), observados os segredos comercial e industrial.',
    '',
    '6.3. Ambas as Partes cooperarão para atender solicitações de titulares no prazo de 15 (quinze) dias corridos, prorrogáveis por igual período mediante justificativa, conforme art. 19 da LGPD.',
  ])

  // ── Clause 6-A – Anonimized data (LGPD Art. 12) ──────────────────────────
  drawSection(ctx, 'CLÁUSULA 6-A — DADOS ANONIMIZADOS (LGPD ART. 12)', [
    '6-A.1. As Partes reconhecem que dados anonimizados não são considerados dados pessoais (art. 12, LGPD) e que a Clinipharma poderá produzir e utilizar datasets agregados e anonimizados derivados dos dados tratados nesta parceria, exclusivamente para finalidades de melhoria de produto, pesquisa estatística agregada, prevenção a fraude, segurança e relatórios de transparência setorial, observada a impossibilidade técnica razoável de reidentificação.',
  ])

  // ── Clause 7 – Liability ──────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 7 — RESPONSABILIDADE E PENALIDADES', [
    '7.1. O descumprimento de qualquer cláusula deste instrumento ou do DPA incorporado sujeitará a parte infratora a:',
    '  (i) Rescisão imediata desta parceria, sem ônus para a parte inocente, observado contraditório quando cabível;',
    '  (ii) Indenização integral pelos danos emergentes e lucros cessantes nos termos dos arts. 402 e 403 do Código Civil, sendo expressamente excluídos danos indiretos não pactuados; e',
    '  (iii) Notificação à ANPD na forma do art. 48 da LGPD, quando a infração constituir violação grave que possa acarretar risco ou dano relevante a titulares.',
    '',
    '7.2. A responsabilidade civil das Partes perante titulares de dados rege-se pelo art. 42 da LGPD, observando-se: (a) a responsabilidade solidária prevista no art. 42, §1º, I, quando a Operadora descumprir as obrigações da LGPD ou as instruções lícitas da Controladora; (b) a responsabilidade solidária prevista no art. 42, §1º, II, entre controladores diretamente envolvidos no tratamento que originou o dano; e (c) o direito de regresso entre as Partes na proporção de suas respectivas culpas (art. 42, §4º).',
    '',
    '7.3. As limitações de responsabilidade entre as Partes não se aplicam aos casos de dolo, fraude, culpa grave, violação de dados sensíveis de saúde, descumprimento intencional ou reiterado das obrigações de notificação de incidente, nem às sanções administrativas aplicadas pela ANPD em razão de conduta exclusivamente imputável a uma das Partes.',
  ])

  // ── Clause 8 – Term ───────────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 8 — VIGÊNCIA', [
    '8.1. Este instrumento entra em vigor na data da assinatura eletrônica avançada por ambas as Partes e permanece válido enquanto houver relação comercial ativa entre elas, conforme o DPA versão ' +
      DPA_VERSION +
      ' incorporado por referência.',
    '',
    '8.2. As obrigações de confidencialidade, segurança e retenção de dados subsistem por prazo não inferior a 10 (dez) anos após o término desta parceria ou pelo prazo exigido pela legislação aplicável (em especial RDC ANVISA 67/2007, Portaria SVS/MS 344/98 e CTN art. 195), o que for maior.',
  ])

  // ── Clause 9 – Governing law ──────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 9 — LEI APLICÁVEL E FORO', [
    `9.1. Este instrumento é regido pelas leis da República Federativa do Brasil, em especial pela LGPD (Lei nº 13.709/2018), pelo Código Civil (Lei nº 10.406/2002), pelo Marco Civil da Internet (Lei nº 12.965/2014), pela Lei nº 14.063/2020 e pela legislação regulatória da ANVISA, ANPD e dos conselhos de classe pertinentes.`,
    '',
    `9.2. Fica eleito o Foro da ${CLINIPHARMA.foro} para dirimir quaisquer controvérsias decorrentes deste instrumento, com renúncia a qualquer outro por mais privilegiado que seja, ressalvada (i) a competência da ANPD para apuração de infrações à LGPD; e (ii) o direito do Parceiro hipossuficiente, quando aplicável, de propor ação no foro de seu domicílio.`,
    '',
    `9.3. Este instrumento é assinado eletronicamente via Clicksign, provedor de assinatura eletrônica avançada com identificação multifatorial, nos termos do art. 5º da Lei nº 14.063/2020 c/c art. 10, §2º, da MP 2.200-2/2001, com plena equivalência probatória às assinaturas físicas (CPC, art. 411, II).`,
  ])

  // ── Signature block ───────────────────────────────────────────────────────
  ensureSpace(ctx, 140)
  ctx.y -= 10
  drawHRule(ctx)

  drawText(ctx, `Brasília, DF, ${date}`, { size: 9, color: rgb(0.4, 0.4, 0.4) })
  ctx.y -= 20

  // Left sig
  ctx.currentPage.drawLine({
    start: { x: 50, y: ctx.y },
    end: { x: 250, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  // Right sig
  ctx.currentPage.drawLine({
    start: { x: 300, y: ctx.y },
    end: { x: 545, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  ctx.y -= 14
  drawText(ctx, party.name.slice(0, 36), { size: 8, x: 50 })
  ctx.currentPage.drawText('ALC INTERMEDIACAO E REPRESENTACAO LTDA', {
    x: 300,
    y: ctx.y + 14,
    font: ctx.font,
    size: 7,
    color: rgb(0.15, 0.15, 0.15),
  })
  ctx.currentPage.drawText(`CNPJ ${CLINIPHARMA.cnpj}`, {
    x: 300,
    y: ctx.y,
    font: ctx.font,
    size: 7,
    color: rgb(0.4, 0.4, 0.4),
  })
  ctx.y -= 12
  if (party.cpfCnpj) {
    ctx.currentPage.drawText(`CNPJ/CPF: ${party.cpfCnpj}`, {
      x: 50,
      y: ctx.y,
      font: ctx.font,
      size: 7,
      color: rgb(0.4, 0.4, 0.4),
    })
  }

  drawPageNumbers(ctx, ctx.pages.length)

  const pdfBytes = await doc.save()
  return Buffer.from(pdfBytes).toString('base64')
}

/** Generate a contract PDF and return base64 string.
 * Uses aiGeneratedBody if provided, otherwise falls back to static template text.
 * For CLINIC and PHARMACY types, delegates to generateDpaPdf for the full DPA document. */
export async function generateContractPdf(params: {
  type: ContractType
  party: ContractParty
  date?: string
  aiGeneratedBody?: string
}): Promise<string> {
  // DPA types get the full multi-page LGPD-compliant PDF
  if (params.type === 'CLINIC' || params.type === 'PHARMACY') {
    return generateDpaPdf({ type: params.type, party: params.party, date: params.date })
  }

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const { type, party } = params
  const date = params.date ?? new Date().toLocaleDateString('pt-BR')

  const TITLES: Record<ContractType, string> = {
    CLINIC: 'Contrato de Adesão — Clínica',
    DOCTOR: 'Contrato de Adesão — Médico',
    PHARMACY: 'Contrato de Fornecimento — Farmácia',
    CONSULTANT: 'Contrato de Consultoria Comercial',
  }

  const BODIES: Record<ContractType, string[]> = {
    CLINIC: [],
    PHARMACY: [],
    DOCTOR: [
      `1. OBJETO. Pelo presente instrumento, o médico acima identificado ("Médico") adere à`,
      `plataforma Clinipharma ("Plataforma"), operada pela Contratada, para fins de`,
      `processamento de pedidos de medicamentos manipulados por ele prescritos, vinculados`,
      `à(s) clínica(s) à(s) qual(is) esteja regularmente associado.`,
      ``,
      `2. DECLARAÇÕES. O Médico declara, sob as penas da lei: (i) possuir registro ativo`,
      `e em situação regular no CRM da unidade da federação indicada acima; (ii) não estar`,
      `sujeito a sanção ética ou administrativa que impeça o exercício da medicina; (iii)`,
      `realizar prescrições estritamente dentro de sua área de atuação, observada a`,
      `Resolução CFM nº 1.931/2009 (Código de Ética Médica) e a Resolução CFM nº 2.314/2022`,
      `(telemedicina), quando aplicável.`,
      ``,
      `3. AUTONOMIA E SIGILO. O Médico atua com plena autonomia técnica e profissional,`,
      `mantendo o sigilo médico nos termos do Código de Ética Médica e da LGPD (art. 11),`,
      `respondendo pessoalmente pelas prescrições emitidas. A Contratada não interfere em`,
      `decisões clínicas e atua exclusivamente como intermediadora tecnológica.`,
      ``,
      `4. PROTEÇÃO DE DADOS. O tratamento de dados pessoais decorrente deste instrumento`,
      `observa a Política de Privacidade vigente em clinipharma.com.br/privacy e o DPA`,
      `aplicável à clínica à qual o Médico está vinculado.`,
      ``,
      `5. AUSÊNCIA DE VÍNCULO EMPREGATÍCIO. Este instrumento não estabelece vínculo`,
      `empregatício, societário ou de representação entre as Partes (CLT arts. 2º e 3º a`,
      `contrario sensu), tratando-se de adesão a serviço tecnológico.`,
      ``,
      `6. VIGÊNCIA E RESCISÃO. Vigência por prazo indeterminado a partir da assinatura,`,
      `podendo ser rescindido por qualquer Parte mediante notificação com antecedência de`,
      `30 dias, e imediatamente em caso de cassação do CRM ou descumprimento das normas do`,
      `CFM ou desta plataforma.`,
    ],
    CONSULTANT: [
      `1. OBJETO. Pelo presente instrumento, o consultor acima identificado ("Consultor")`,
      `presta à Clinipharma ("Contratante") serviços autônomos de captação, suporte`,
      `comercial e relacionamento com clínicas e médicos para utilização da plataforma,`,
      `sem subordinação jurídica, hierárquica ou habitualidade no sentido celetista.`,
      ``,
      `2. NATUREZA AUTÔNOMA. As Partes ajustam expressamente que (i) inexiste vínculo`,
      `empregatício, societário, de mandato ou de representação comercial nos termos da Lei`,
      `4.886/65, (ii) o Consultor é livre para definir seu método de trabalho, horários e`,
      `localização, e (iii) cabe ao Consultor recolher os tributos, contribuições e demais`,
      `encargos incidentes sobre a remuneração recebida (CC art. 593 — prestação de serviço).`,
      ``,
      `3. REMUNERAÇÃO. O Consultor receberá comissão percentual sobre o valor líquido dos`,
      `pedidos efetivamente pagos pelas clínicas sob sua responsabilidade comercial,`,
      `conforme tabela de comissões vigente, mediante apresentação de Nota Fiscal de`,
      `Serviço (NFS-e), no prazo acordado entre as Partes após a confirmação do pagamento`,
      `pelo cliente final.`,
      ``,
      `4. CONFIDENCIALIDADE E PROTEÇÃO DE DADOS. O Consultor obriga-se a manter sigilo`,
      `sobre todas as informações comerciais, técnicas, financeiras e pessoais a que tiver`,
      `acesso, observando a LGPD (Lei nº 13.709/2018) e o DPA Clínicas/Farmácias quando`,
      `pertinente, com obrigação de sigilo subsistente por 5 (cinco) anos após o término.`,
      ``,
      `5. NÃO-CONCORRÊNCIA. Durante a vigência e por 12 (doze) meses após o término, o`,
      `Consultor não poderá prestar serviços a plataforma concorrente direta da Clinipharma`,
      `nem aliciar clínicas ou farmácias da carteira ativa, sob pena de multa contratual`,
      `equivalente a 6 (seis) vezes a média mensal das comissões pagas nos últimos 12 meses.`,
      ``,
      `6. VIGÊNCIA E RESCISÃO. Vigência por prazo indeterminado, podendo ser rescindido`,
      `por qualquer Parte mediante notificação com antecedência de 30 dias, e imediatamente`,
      `por justa causa em caso de violação das obrigações de confidencialidade ou`,
      `não-concorrência.`,
    ],
  }

  let y = 780

  // Header
  page.drawText('CLINIPHARMA', { x: 50, y, font: boldFont, size: 16, color: rgb(0.07, 0.22, 0.37) })
  y -= 25
  page.drawText(TITLES[type], { x: 50, y, font: boldFont, size: 13, color: rgb(0.1, 0.1, 0.1) })
  y -= 30

  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  })
  y -= 20

  page.drawText('PARTES:', { x: 50, y, font: boldFont, size: 10 })
  y -= 16
  page.drawText(`CONTRATANTE: ${party.name}`, { x: 50, y, font, size: 10 })
  y -= 14
  if (party.cpfCnpj) {
    page.drawText(`CPF/CNPJ: ${party.cpfCnpj}`, { x: 50, y, font, size: 10 })
    y -= 14
  }
  if (party.email) {
    page.drawText(`E-mail: ${party.email}`, { x: 50, y, font, size: 10 })
    y -= 14
  }
  page.drawText(`CONTRATADA: ${CLINIPHARMA.razaoSocial}`, { x: 50, y, font, size: 10 })
  y -= 14
  page.drawText(`CNPJ: ${CLINIPHARMA.cnpj}`, { x: 50, y, font, size: 10 })
  y -= 25

  page.drawText('OBJETO E CONDIÇÕES:', { x: 50, y, font: boldFont, size: 10 })
  y -= 16
  const bodyLines = params.aiGeneratedBody
    ? params.aiGeneratedBody.split('\n').flatMap((line) => {
        const words = line.split(' ')
        const wrapped: string[] = []
        let current = ''
        for (const word of words) {
          if ((current + ' ' + word).length > 90) {
            wrapped.push(current)
            current = word
          } else {
            current = current ? current + ' ' + word : word
          }
        }
        if (current) wrapped.push(current)
        return wrapped
      })
    : BODIES[type]

  for (const line of bodyLines) {
    page.drawText(line, { x: 50, y, font, size: 10, color: rgb(0.2, 0.2, 0.2) })
    y -= 15
    if (y < 100) break
  }

  y -= 20
  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  })
  y -= 20

  const lawLines = [
    `Regido pelas leis da República Federativa do Brasil, em especial Código Civil, Marco Civil`,
    `da Internet (Lei 12.965/2014), LGPD (Lei 13.709/2018) e Lei 14.063/2020.`,
    `Foro: ${CLINIPHARMA.foro}, ressalvado o direito do hipossuficiente de propor ação no foro de seu domicílio.`,
    `Assinatura eletrônica avançada via Clicksign (Lei 14.063/2020, art. 5º; MP 2.200-2/2001).`,
  ]
  for (const line of lawLines) {
    page.drawText(line, { x: 50, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) })
    y -= 11
  }
  y -= 4
  page.drawText(`Data: ${date}`, { x: 50, y, font, size: 9, color: rgb(0.5, 0.5, 0.5) })

  y -= 60
  page.drawLine({
    start: { x: 50, y },
    end: { x: 250, y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  page.drawLine({
    start: { x: 300, y },
    end: { x: 545, y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  y -= 14
  page.drawText(party.name, { x: 50, y, font, size: 8 })
  page.drawText(`${CLINIPHARMA.razaoSocial}`, { x: 300, y, font, size: 7 })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes).toString('base64')
}

// ── Full contract flow ────────────────────────────────────────────────────────

/**
 * Generate contract PDF, upload to Clicksign, add signers and notify.
 * Returns { documentKey, signerKey }.
 * Accepts an optional aiGeneratedBody to replace the static contract text.
 */
export async function createAndSendContract(params: {
  type: ContractType
  party: ContractParty
  clinipharmaRepEmail?: string
  /** AI-generated personalized contract body text */
  aiGeneratedBody?: string
}): Promise<{ documentKey: string; signerKey: string }> {
  const pdfBase64 = await generateContractPdf({
    type: params.type,
    party: params.party,
    aiGeneratedBody: params.aiGeneratedBody,
  })
  const filename = `contrato_${params.type.toLowerCase()}_${Date.now()}.pdf`
  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const documentKey = await uploadDocument({ filename, base64Content: pdfBase64, deadline })

  // Add party signer
  const signerKey = await addSigner({
    documentKey,
    email: params.party.email ?? '',
    name: params.party.name,
    cpf: params.party.cpfCnpj,
  })

  // Add Clinipharma representative as co-signer when provided
  if (params.clinipharmaRepEmail) {
    await addSigner({
      documentKey,
      email: params.clinipharmaRepEmail,
      name: CLINIPHARMA.razaoSocial,
    })
  }

  await notifySigners(documentKey)

  return { documentKey, signerKey }
}
