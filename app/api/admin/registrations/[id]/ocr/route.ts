import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { extractDocumentData } from '@/lib/ai'
import { logger } from '@/lib/logger'

/**
 * POST /api/admin/registrations/[id]/ocr
 * Triggers OCR analysis on all documents of a registration request.
 * Returns extracted data per document for comparison with form data.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const admin = createAdminClient()

  // Fetch the registration request + form data
  const { data: request, error: reqErr } = await admin
    .from('registration_requests')
    .select('id, type, form_data, user_id')
    .eq('id', id)
    .single()

  if (reqErr || !request) {
    return NextResponse.json({ error: 'Solicitação não encontrada' }, { status: 404 })
  }

  // Fetch uploaded documents from storage
  const { data: documents, error: docsErr } = await admin.storage
    .from('registration-documents')
    .list(id)

  if (docsErr) {
    logger.error('[ocr] storage list failed', { error: docsErr, registrationId: id })
    return NextResponse.json({ error: 'Erro ao acessar documentos' }, { status: 500 })
  }

  if (!documents || documents.length === 0) {
    return NextResponse.json({ error: 'Nenhum documento encontrado' }, { status: 404 })
  }

  // Process each document with OCR (max 5 to control cost)
  const results = await Promise.allSettled(
    documents.slice(0, 5).map(async (doc) => {
      const { data: signedUrl } = await admin.storage
        .from('registration-documents')
        .createSignedUrl(`${id}/${doc.name}`, 120) // 2-minute signed URL

      if (!signedUrl?.signedUrl) {
        return { filename: doc.name, error: 'URL não gerada' }
      }

      const extracted = await extractDocumentData(signedUrl.signedUrl)

      return {
        filename: doc.name,
        extracted,
        size: doc.metadata?.size,
        contentType: doc.metadata?.mimetype,
      }
    })
  )

  const formData = request.form_data as Record<string, string>

  // Build comparison: extracted vs. form data
  const extractions = results.map((r) => {
    if (r.status === 'rejected') return { error: String(r.reason) }
    return r.value
  })

  // Aggregate: if any document has a CNPJ, compare with form
  const allExtracted = extractions.flatMap((e) => ('extracted' in e ? [e.extracted] : []))
  const cnpjMatch = allExtracted.some(
    (e) => e?.cnpj?.replace(/\D/g, '') === formData.cnpj?.replace(/\D/g, '')
  )
  const nameMatch = allExtracted.some((e) => {
    if (!e?.razao_social || !formData.corporate_name) return false
    return (
      e.razao_social.toLowerCase().includes(formData.corporate_name?.toLowerCase()) ||
      formData.corporate_name?.toLowerCase().includes(e.razao_social.toLowerCase())
    )
  })

  logger.info('[ocr] extraction complete', { registrationId: id, docs: documents.length })

  return NextResponse.json({
    registrationId: id,
    formData: {
      cnpj: formData.cnpj,
      corporate_name: formData.corporate_name ?? formData.full_name,
    },
    extractions,
    summary: {
      documentsAnalyzed: documents.length,
      cnpjMatch,
      nameMatch,
      overallConfidence:
        allExtracted.length === 0
          ? 'low'
          : allExtracted.some((e) => e?.raw_confidence === 'high')
            ? 'high'
            : 'medium',
    },
  })
}
