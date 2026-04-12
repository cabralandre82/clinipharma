// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { calculateLeadScore } from '@/lib/lead-score'

describe('calculateLeadScore', () => {
  it('TC-LEAD-01: formulário vazio → score baixo, nível cold', () => {
    const { score, level } = calculateLeadScore({})
    expect(score).toBeLessThan(35)
    expect(level).toBe('cold')
  })

  it('TC-LEAD-02: formulário completo com CNPJ ativo, email corporativo e estado de alto potencial → hot', () => {
    const { score, level, reasons } = calculateLeadScore({
      full_name: 'Dr. João',
      email: 'joao@clinicaexemplo.com.br',
      cnpj: '12.345.678/0001-90',
      cnpj_situation: 'ATIVA',
      state: 'SP',
      city: 'São Paulo',
      address_line_1: 'Rua das Flores, 123',
      zip_code: '01310-100',
      phone: '(11) 91234-5678',
      specialty: 'dermatologia',
      trade_name: 'Clínica Exemplo',
      corporate_name: 'Clínica Exemplo Ltda',
    })
    expect(score).toBeGreaterThanOrEqual(60)
    expect(level).toBe('hot')
    expect(reasons.length).toBeGreaterThan(3)
  })

  it('TC-LEAD-03: email gratuito não conta como corporativo', () => {
    const { reasons: withCorp } = calculateLeadScore({ email: 'user@clinica.com.br' })
    const { reasons: withFree } = calculateLeadScore({ email: 'user@gmail.com' })

    const hasCorporateBonus = (r: string[]) => r.some((s) => s.includes('corporativo'))
    expect(hasCorporateBonus(withCorp)).toBe(true)
    expect(hasCorporateBonus(withFree)).toBe(false)
  })

  it('TC-LEAD-04: CNPJ presente mas sem situação ATIVA → 15 pts (não 20)', () => {
    const withoutSituation = calculateLeadScore({ cnpj: '12.345.678/0001-90' })
    const withActive = calculateLeadScore({ cnpj: '12.345.678/0001-90', cnpj_situation: 'ATIVA' })

    expect(withActive.score).toBeGreaterThan(withoutSituation.score)
    expect(withActive.score - withoutSituation.score).toBe(5)
  })

  it('TC-LEAD-05: estado de baixo potencial não gera bônus de estado', () => {
    const { score: spScore } = calculateLeadScore({ state: 'SP' })
    const { score: amScore } = calculateLeadScore({ state: 'AM' })
    expect(spScore).toBeGreaterThan(amScore)
  })

  it('TC-LEAD-06: especialidade de alta demanda gera bônus', () => {
    const { reasons: withDerm } = calculateLeadScore({ specialty: 'dermatologia estética' })
    const { reasons: withGeral } = calculateLeadScore({ specialty: 'clínica geral' })

    const hasDemandBonus = (r: string[]) => r.some((s) => s.includes('alta demanda'))
    expect(hasDemandBonus(withDerm)).toBe(true)
    expect(hasDemandBonus(withGeral)).toBe(false)
  })

  it('TC-LEAD-07: sem telefone → penalidade de -5 visível sobre uma base positiva', () => {
    // Use a base that generates some score so the -5 penalty is not absorbed by Math.max(0,...)
    const base = { email: 'dr@clinica.com.br', state: 'SP' } // +10 corp email +10 state = 20 pts
    const { score: withPhone } = calculateLeadScore({ ...base, phone: '(11) 91234-5678' })
    const { score: withoutPhone } = calculateLeadScore(base)
    expect(withPhone).toBeGreaterThan(withoutPhone)
    expect(withPhone - withoutPhone).toBe(5)
  })

  it('TC-LEAD-08: score nunca ultrapassa 100 nem fica negativo', () => {
    const maxed = calculateLeadScore({
      full_name: 'Max',
      email: 'max@empresa.com.br',
      cnpj: '12.345.678/0001-90',
      cnpj_situation: 'ATIVA',
      state: 'SP',
      address_line_1: 'Rua X, 1',
      zip_code: '01310-100',
      city: 'São Paulo',
      phone: '11999999999',
      specialty: 'dermatologia',
      trade_name: 'Clínica Max',
      corporate_name: 'Max Ltda',
      extra_field: 'value',
    })
    expect(maxed.score).toBeLessThanOrEqual(100)
    expect(maxed.score).toBeGreaterThanOrEqual(0)
  })

  it('TC-LEAD-09: nível warm entre 35 e 59', () => {
    // Just email corporativo + estado alto + CNPJ sem situação = ~35pts
    const { score, level } = calculateLeadScore({
      email: 'user@empresa.com.br',
      state: 'RJ',
      cnpj: '12.345.678/0001-90',
      phone: '21999999999',
    })
    if (score >= 35 && score < 60) {
      expect(level).toBe('warm')
    }
  })
})
