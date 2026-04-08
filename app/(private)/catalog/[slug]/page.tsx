import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { notFound } from 'next/navigation'
import { ProductDetail } from '@/components/catalog/product-detail'

interface ProductPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('products').select('name').eq('slug', slug).single()
  return { title: data?.name ?? 'Produto' }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: product } = await supabase
    .from('products')
    .select(
      `
      *,
      product_categories (id, name, slug),
      pharmacies (id, trade_name, city, state),
      product_images (id, public_url, alt_text, sort_order),
      product_price_history (id, old_price, new_price, reason, created_at)
    `
    )
    .eq('slug', slug)
    .eq('active', true)
    .single()

  if (!product) notFound()

  return <ProductDetail product={product} />
}
