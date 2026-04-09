import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotificationForRole } from '@/lib/notifications'
import { Resend } from 'resend'
import { productInterestSchema } from '@/lib/validators'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const body = await req.json()
    const parsed = productInterestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }

    const { product_id, name, whatsapp } = parsed.data
    const admin = createAdminClient()

    // Fetch product name for notifications
    const { data: product } = await admin
      .from('products')
      .select('name, sku, status')
      .eq('id', product_id)
      .single()

    if (!product || product.status !== 'unavailable') {
      return NextResponse.json({ error: 'Produto não encontrado ou disponível' }, { status: 404 })
    }

    // Save interest
    const { error } = await admin.from('product_interests').insert({
      product_id,
      user_id: user.id,
      name,
      whatsapp,
    })

    if (error) {
      console.error('[interest] insert error:', error.message)
      return NextResponse.json({ error: 'Erro ao registrar interesse' }, { status: 500 })
    }

    const notifTitle = `Novo interesse: ${product.name}`
    const notifBody = `${name} · WhatsApp: ${whatsapp}`

    // In-app notification to SUPER_ADMIN
    await createNotificationForRole('SUPER_ADMIN', {
      type: 'PRODUCT_INTEREST',
      title: notifTitle,
      body: notifBody,
      link: '/interests',
    })

    // Email to SUPER_ADMIN
    const { data: admins } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'SUPER_ADMIN')

    if (admins && admins.length > 0) {
      const { data: adminProfiles } = await admin
        .from('profiles')
        .select('email')
        .in(
          'id',
          admins.map((a) => a.user_id)
        )

      const adminEmails = adminProfiles?.map((p) => p.email).filter(Boolean) ?? []

      if (adminEmails.length > 0) {
        await resend.emails.send({
          from: 'Clinipharma <noreply@clinipharma.com.br>',
          to: adminEmails as string[],
          subject: `Interesse registrado: ${product.name}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
              <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
                <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
              </div>
              <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
                <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin-bottom:20px">
                  <p style="margin:0;font-size:14px;color:#92400e;font-weight:600">Novo interesse registrado</p>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:14px">
                  <tr>
                    <td style="padding:8px 0;color:#64748b;width:35%">Produto</td>
                    <td style="padding:8px 0;color:#1e293b;font-weight:600">${product.name}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#64748b">SKU</td>
                    <td style="padding:8px 0;color:#1e293b">${product.sku}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#64748b">Interessado</td>
                    <td style="padding:8px 0;color:#1e293b;font-weight:600">${name}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#64748b">WhatsApp</td>
                    <td style="padding:8px 0">
                      <a href="https://wa.me/${whatsapp.replace(/\D/g, '')}" style="color:#1e3a5f;font-weight:600">${whatsapp}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#64748b">Email do usuário</td>
                    <td style="padding:8px 0;color:#1e293b">${user.email}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;text-align:center">
                  <a href="https://clinipharma.com.br/interests"
                     style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">
                    Ver todos os interesses
                  </a>
                </div>
              </div>
              <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:16px">
                Clinipharma · Plataforma B2B de intermediação médica
              </p>
            </div>
          `,
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[interest] unexpected error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
