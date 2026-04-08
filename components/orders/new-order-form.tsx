'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { createOrder } from '@/services/orders'
import { orderSchema, type OrderFormData } from '@/lib/validators'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, Package, Upload, X, FileText } from 'lucide-react'

export interface NewOrderFormProduct {
  id: string
  name: string
  concentration: string
  presentation: string
  price_current: number
  estimated_deadline_days: number
  pharmacies: { id: string; trade_name: string } | null
  product_images: { id: string; public_url: string | null; sort_order: number }[]
}

interface NewOrderFormProps {
  product: NewOrderFormProduct
  clinics: { id: string; trade_name: string }[]
  doctors: { id: string; full_name: string; crm: string; crm_state: string }[]
}

export function NewOrderForm({ product, clinics, doctors }: NewOrderFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [documents, setDocuments] = useState<File[]>([])

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<OrderFormData>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      product_id: product.id,
      quantity: 1,
    },
  })

  const watchQuantity = watch('quantity')
  const total = product.price_current * (watchQuantity || 1)

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setDocuments((prev) => [...prev, ...files])
    e.target.value = ''
  }

  const removeDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index))
  }

  async function onSubmit(data: OrderFormData) {
    setLoading(true)
    try {
      const result = await createOrder({ ...data, documents })

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Pedido criado com sucesso!')
      router.push(`/orders/${result.orderId}`)
    } catch {
      toast.error('Erro ao criar pedido. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Product summary */}
      <Card className="border-blue-100 bg-blue-50/50">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-white">
              <Package className="h-7 w-7 text-blue-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-gray-900">{product.name}</p>
              <p className="text-sm text-gray-500">
                {product.concentration} · {product.presentation}
              </p>
              {product.pharmacies && (
                <p className="mt-0.5 text-xs text-gray-400">
                  Farmácia: {product.pharmacies.trade_name}
                </p>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-lg font-bold text-[hsl(213,75%,24%)]">
                {formatCurrency(product.price_current)}
              </p>
              <p className="text-xs text-gray-400">por unidade</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <input type="hidden" {...register('product_id')} />

      {/* Clinic and Doctor */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Dados do pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="clinic_id">Clínica *</Label>
            <select
              id="clinic_id"
              {...register('clinic_id')}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[hsl(196,91%,36%)] focus:outline-none"
            >
              <option value="">Selecione a clínica...</option>
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.trade_name}
                </option>
              ))}
            </select>
            {errors.clinic_id && <p className="text-xs text-red-500">{errors.clinic_id.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doctor_id">Médico solicitante *</Label>
            <select
              id="doctor_id"
              {...register('doctor_id')}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[hsl(196,91%,36%)] focus:outline-none"
            >
              <option value="">Selecione o médico...</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} — CRM {d.crm}/{d.crm_state}
                </option>
              ))}
            </select>
            {errors.doctor_id && <p className="text-xs text-red-500">{errors.doctor_id.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quantity">Quantidade *</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              {...register('quantity', { valueAsNumber: true })}
              className={`w-32 ${errors.quantity ? 'border-red-500' : ''}`}
            />
            {errors.quantity && <p className="text-xs text-red-500">{errors.quantity.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              placeholder="Informações adicionais para o pedido (opcional)"
              rows={3}
              {...register('notes')}
            />
          </div>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Documentação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-500">
            Anexe a prescrição médica e demais documentos obrigatórios. O pedido só avançará após
            análise documental.
          </p>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 p-6 transition-colors hover:border-[hsl(196,91%,36%)] hover:bg-blue-50/50">
            <Upload className="h-5 w-5 text-gray-400" />
            <span className="text-sm text-gray-500">
              Clique para anexar documentos (PDF, JPG, PNG)
            </span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              onChange={handleFileAdd}
            />
          </label>

          {documents.length > 0 && (
            <ul className="space-y-2">
              {documents.map((file, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="flex-1 truncate text-sm text-gray-700">{file.name}</span>
                  <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    onClick={() => removeDocument(i)}
                    className="text-gray-400 transition-colors hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Order summary */}
      <Card className="border-gray-200 bg-gray-50">
        <CardContent className="p-5">
          <h3 className="mb-3 font-semibold text-gray-900">Resumo do pedido</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Produto</span>
              <span className="ml-4 max-w-[200px] truncate text-gray-900">{product.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Preço unitário</span>
              <span className="text-gray-900">{formatCurrency(product.price_current)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Quantidade</span>
              <span className="text-gray-900">{watchQuantity || 1}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="text-[hsl(213,75%,24%)]">{formatCurrency(total)}</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Prazo estimado: {product.estimated_deadline_days} dias úteis após liberação
            </p>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Criando pedido...
          </>
        ) : (
          'Confirmar pedido'
        )}
      </Button>
    </form>
  )
}
