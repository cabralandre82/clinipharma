import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  clinicSchema,
  orderSchema,
  priceUpdateSchema,
  doctorSchema,
} from '@/lib/validators'

describe('loginSchema', () => {
  it('accepts valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'user@test.com', password: '123456' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: '123456' })
    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = loginSchema.safeParse({ email: 'user@test.com', password: '123' })
    expect(result.success).toBe(false)
  })
})

describe('priceUpdateSchema', () => {
  it('accepts valid price update', () => {
    const result = priceUpdateSchema.safeParse({ new_price: 500, reason: 'Atualização de outubro' })
    expect(result.success).toBe(true)
  })

  it('rejects negative price', () => {
    const result = priceUpdateSchema.safeParse({ new_price: -10, reason: 'Motivo' })
    expect(result.success).toBe(false)
  })

  it('rejects short reason', () => {
    const result = priceUpdateSchema.safeParse({ new_price: 500, reason: 'curto' })
    expect(result.success).toBe(false)
  })
})

describe('orderSchema', () => {
  const VALID_UUID_1 = '550e8400-e29b-41d4-a716-446655440001'
  const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440002'
  const VALID_UUID_3 = '550e8400-e29b-41d4-a716-446655440003'

  it('accepts valid order', () => {
    const result = orderSchema.safeParse({
      product_id: VALID_UUID_1,
      clinic_id: VALID_UUID_2,
      doctor_id: VALID_UUID_3,
      quantity: 2,
    })
    expect(result.success).toBe(true)
  })

  it('rejects zero quantity', () => {
    const result = orderSchema.safeParse({
      product_id: VALID_UUID_1,
      clinic_id: VALID_UUID_2,
      doctor_id: VALID_UUID_3,
      quantity: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid UUID', () => {
    const result = orderSchema.safeParse({
      product_id: 'not-a-uuid',
      clinic_id: VALID_UUID_2,
      doctor_id: VALID_UUID_3,
      quantity: 1,
    })
    expect(result.success).toBe(false)
  })
})

describe('doctorSchema', () => {
  it('accepts valid doctor', () => {
    const result = doctorSchema.safeParse({
      full_name: 'Dr. Carlos Silva',
      crm: '123456',
      crm_state: 'SP',
      email: 'dr@test.com',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid CRM state (too long)', () => {
    const result = doctorSchema.safeParse({
      full_name: 'Dr. Carlos',
      crm: '123456',
      crm_state: 'SPA',
      email: 'dr@test.com',
    })
    expect(result.success).toBe(false)
  })
})
