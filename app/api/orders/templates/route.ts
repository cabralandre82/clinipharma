import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { z } from 'zod'

const templateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(100),
  clinicId: z.string().uuid('clinicId inválido'),
  items: z.array(z.unknown()).min(1, 'Adicione ao menos um item'),
})

type AdminClient = ReturnType<typeof createAdminClient>

async function getUserRoles(userId: string, admin: AdminClient) {
  const { data } = await admin.from('user_roles').select('role').eq('user_id', userId)
  return (data ?? []).map((r) => r.role as string)
}

async function isClinicMember(
  userId: string,
  clinicId: string,
  admin: AdminClient
): Promise<boolean> {
  const { data } = await admin
    .from('clinic_members')
    .select('user_id')
    .eq('user_id', userId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  return !!data
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const clinicId = searchParams.get('clinicId')
  if (!clinicId) return NextResponse.json({ error: 'clinicId required' }, { status: 400 })

  const admin = createAdminClient()
  const roles = await getUserRoles(user.id, admin)
  const isAdmin = roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  if (!isAdmin && !(await isClinicMember(user.id, clinicId, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('order_templates')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = templateSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { name, clinicId, items } = parsed.data
  const admin = createAdminClient()
  const roles = await getUserRoles(user.id, admin)
  const isAdmin = roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  if (!isAdmin && !(await isClinicMember(user.id, clinicId, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('order_templates')
    .insert({ name, clinic_id: clinicId, items, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()

  // Fetch template to verify ownership
  const { data: template } = await admin
    .from('order_templates')
    .select('clinic_id, created_by')
    .eq('id', id)
    .maybeSingle()

  if (!template) return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })

  const roles = await getUserRoles(user.id, admin)
  const isAdmin = roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  const isCreator = template.created_by === user.id
  const isMember = await isClinicMember(user.id, template.clinic_id, admin)

  if (!isAdmin && !isCreator && !isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await admin.from('order_templates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
