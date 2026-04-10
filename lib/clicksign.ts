import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const BASE_URL = process.env.CLICKSIGN_API_URL ?? 'https://sandbox.clicksign.com/api/v1'
const ACCESS_TOKEN = process.env.CLICKSIGN_ACCESS_TOKEN ?? ''

async function clicksignFetch<T>(path: string, options?: RequestInit): Promise<T> {
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

/** Generate a simple contract PDF and return base64 string. */
export async function generateContractPdf(params: {
  type: ContractType
  party: ContractParty
  date?: string
}): Promise<string> {
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
    CLINIC: [
      `Pelo presente instrumento, a clínica acima identificada ("Contratante") adere à`,
      `plataforma Clinipharma ("Contratada"), concordando com os termos de uso, política`,
      `de privacidade e regras operacionais vigentes, disponíveis em clinipharma.com.br.`,
      ``,
      `A Contratante autoriza a Clinipharma a intermediar pedidos de medicamentos e`,
      `produtos farmacêuticos junto às farmácias parceiras, retendo a comissão de`,
      `intermediação conforme tabela de preços vigente.`,
    ],
    DOCTOR: [
      `Pelo presente instrumento, o médico acima identificado ("Contratante") adere à`,
      `plataforma Clinipharma ("Contratada"), concordando com os termos de uso, política`,
      `de privacidade e regras operacionais vigentes, disponíveis em clinipharma.com.br.`,
      ``,
      `O Contratante declara possuir registro ativo no CRM e autoriza a Clinipharma a`,
      `processar pedidos de medicamentos em seu nome, vinculados à(s) clínica(s) à(s)`,
      `qual(is) está associado.`,
    ],
    PHARMACY: [
      `Pelo presente instrumento, a farmácia acima identificada ("Contratada") firma`,
      `parceria com a Clinipharma ("Contratante") para fornecimento de medicamentos e`,
      `produtos farmacêuticos através da plataforma digital.`,
      ``,
      `A Contratada compromete-se a: (i) manter o catálogo de produtos atualizado;`,
      `(ii) executar os pedidos dentro do prazo acordado; (iii) emitir NF-e para cada`,
      `entrega; (iv) aceitar o repasse financeiro conforme tabela de comissões vigente.`,
    ],
    CONSULTANT: [
      `Pelo presente instrumento, o consultor acima identificado ("Contratado") firma`,
      `contrato de prestação de serviços comerciais com a Clinipharma ("Contratante").`,
      ``,
      `O Contratado atuará na captação e gestão de clínicas e médicos na plataforma,`,
      `recebendo comissão percentual sobre o valor dos pedidos das clínicas sob sua`,
      `responsabilidade, conforme tabela de comissões vigente.`,
    ],
  }

  let y = 780

  // Header
  page.drawText('CLINIPHARMA', { x: 50, y, font: boldFont, size: 16, color: rgb(0.07, 0.22, 0.37) })
  y -= 25
  page.drawText(TITLES[type], { x: 50, y, font: boldFont, size: 13, color: rgb(0.1, 0.1, 0.1) })
  y -= 30

  // Divider
  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  })
  y -= 20

  // Party info
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
  page.drawText(`CONTRATADA: Clinipharma Ltda.`, { x: 50, y, font, size: 10 })
  y -= 25

  // Body
  page.drawText('OBJETO E CONDIÇÕES:', { x: 50, y, font: boldFont, size: 10 })
  y -= 16
  for (const line of BODIES[type]) {
    page.drawText(line, { x: 50, y, font, size: 10, color: rgb(0.2, 0.2, 0.2) })
    y -= 15
  }

  y -= 20
  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  })
  y -= 20

  // Terms
  page.drawText('Este contrato é regido pelas leis brasileiras. Foro: Comarca de São Paulo/SP.', {
    x: 50,
    y,
    font,
    size: 9,
    color: rgb(0.5, 0.5, 0.5),
  })
  y -= 15
  page.drawText(`Data: ${date}`, { x: 50, y, font, size: 9, color: rgb(0.5, 0.5, 0.5) })

  // Signature areas
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
  page.drawText('Clinipharma', { x: 300, y, font, size: 8 })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes).toString('base64')
}

// ── Full contract flow ────────────────────────────────────────────────────────

/**
 * Generate contract PDF, upload to Clicksign, add signers and notify.
 * Returns { documentKey, signerKey }.
 */
export async function createAndSendContract(params: {
  type: ContractType
  party: ContractParty
  clinipharmaRepEmail?: string
}): Promise<{ documentKey: string; signerKey: string }> {
  const pdfBase64 = await generateContractPdf({ type: params.type, party: params.party })
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

  // Optionally add Clinipharma representative
  if (params.clinipharmaRepEmail) {
    await addSigner({
      documentKey,
      email: params.clinipharmaRepEmail,
      name: 'Clinipharma',
    })
  }

  await notifySigners(documentKey)

  return { documentKey, signerKey }
}
