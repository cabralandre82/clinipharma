'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileText, Upload, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'

export const REQUIRED_DOCUMENT_TYPES: {
  type: string
  label: string
  description: string
  required: boolean
}[] = [
  {
    type: 'PRESCRIPTION',
    label: 'Receita médica',
    description: 'Receita original ou digitalizada',
    required: true,
  },
  {
    type: 'IDENTITY',
    label: 'Documento de identidade',
    description: 'RG, CNH ou passaporte do paciente',
    required: false,
  },
  {
    type: 'MEDICAL_REPORT',
    label: 'Relatório médico',
    description: 'Justificativa clínica do uso',
    required: false,
  },
  {
    type: 'AUTHORIZATION',
    label: 'Autorização especial',
    description: 'Para substâncias controladas',
    required: false,
  },
  { type: 'OTHER', label: 'Outro', description: 'Demais documentos', required: false },
]

const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  REQUIRED_DOCUMENT_TYPES.map((d) => [d.type, d.label])
)

interface DocumentManagerProps {
  orderId: string
  documents: Array<{
    id: string
    document_type: string
    original_filename: string
    mime_type: string
    file_size: number
    created_at: string
  }>
  canUpload: boolean
}

export function DocumentManager({ orderId, documents, canUpload }: DocumentManagerProps) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [selectedType, setSelectedType] = useState('PRESCRIPTION')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadedTypes = new Set(documents.map((d) => d.document_type))

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('orderId', orderId)
      formData.append('documentType', selectedType)
      for (const file of files) formData.append('files', file)

      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? 'Erro ao fazer upload')
        return
      }
      toast.success('Documento(s) enviado(s) com sucesso!')
      router.refresh()
    } catch {
      toast.error('Erro ao enviar documento. Tente novamente.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      {/* Required types checklist */}
      <div className="space-y-2">
        {REQUIRED_DOCUMENT_TYPES.filter((t) => t.required).map((docType) => {
          const present = uploadedTypes.has(docType.type)
          return (
            <div
              key={docType.type}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                present ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-amber-50'
              }`}
            >
              {present ? (
                <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" />
              )}
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${present ? 'text-green-800' : 'text-amber-800'}`}
                >
                  {docType.label}
                </p>
                <p className={`text-xs ${present ? 'text-green-600' : 'text-amber-600'}`}>
                  {present ? 'Enviado' : docType.description + ' (obrigatório)'}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Uploaded documents list */}
      {documents.length > 0 && (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
            >
              <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-800">{doc.original_filename}</p>
                <p className="text-xs text-gray-400">
                  {(doc.file_size / 1024).toFixed(0)} KB · {formatDate(doc.created_at)}
                </p>
              </div>
              <Badge variant="secondary" className="flex-shrink-0 text-xs">
                {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {documents.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <p>Nenhum documento anexado. O pedido não avançará sem a receita médica.</p>
        </div>
      )}

      {/* Upload form */}
      {canUpload && (
        <div className="space-y-3 rounded-lg border border-dashed border-gray-200 p-4">
          <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Adicionar documento
          </p>
          <div className="flex gap-2">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
            >
              {REQUIRED_DOCUMENT_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? 'Enviando…' : 'Enviar arquivo'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              onChange={handleUpload}
            />
          </div>
          <p className="text-xs text-gray-400">Formatos aceitos: PDF, JPG, PNG (máx. 10 MB)</p>
        </div>
      )}
    </div>
  )
}

// Re-export for convenience in order-detail
export { DOC_TYPE_LABELS }
