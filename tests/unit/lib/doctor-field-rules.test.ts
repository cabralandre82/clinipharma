import { describe, it, expect } from 'vitest'
import { resolveDoctorFieldState } from '@/lib/orders/doctor-field-rules'

const doctor = { id: 'd1', full_name: 'Dr. Silva', crm: '12345', crm_state: 'SP' }

const noRx = { requires_prescription: false }
const withRx = { requires_prescription: true }

describe('resolveDoctorFieldState', () => {
  it('hides field when clinic has no linked doctors', () => {
    expect(resolveDoctorFieldState([], [])).toEqual({ show: false, required: false })
    expect(resolveDoctorFieldState([withRx], [])).toEqual({ show: false, required: false })
    expect(resolveDoctorFieldState([noRx], [])).toEqual({ show: false, required: false })
  })

  it('shows field as optional when clinic has doctors but no prescription product', () => {
    expect(resolveDoctorFieldState([], [doctor])).toEqual({ show: true, required: false })
    expect(resolveDoctorFieldState([noRx], [doctor])).toEqual({ show: true, required: false })
    expect(resolveDoctorFieldState([noRx, noRx], [doctor])).toEqual({ show: true, required: false })
  })

  it('shows field as required when at least one product requires prescription', () => {
    expect(resolveDoctorFieldState([withRx], [doctor])).toEqual({ show: true, required: true })
    expect(resolveDoctorFieldState([noRx, withRx], [doctor])).toEqual({
      show: true,
      required: true,
    })
    expect(resolveDoctorFieldState([withRx, withRx], [doctor])).toEqual({
      show: true,
      required: true,
    })
  })

  it('required only when clinic has doctors AND cart has prescription product', () => {
    // prescription product but no doctors → hidden, not required
    expect(resolveDoctorFieldState([withRx], [])).toEqual({ show: false, required: false })
  })

  it('works with multiple linked doctors', () => {
    const doctors = [doctor, { ...doctor, id: 'd2' }]
    expect(resolveDoctorFieldState([withRx], doctors)).toEqual({ show: true, required: true })
    expect(resolveDoctorFieldState([noRx], doctors)).toEqual({ show: true, required: false })
  })
})
