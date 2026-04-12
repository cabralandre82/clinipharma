/**
 * Lead scoring for incomplete registration drafts.
 * Pure function — no DB calls, no external APIs.
 * Uses only data already available in the registration_drafts.form_data field.
 */

export type LeadLevel = 'hot' | 'warm' | 'cold'

export interface LeadScore {
  score: number
  level: LeadLevel
  reasons: string[]
}

// CNPJ municipalities with higher pharma market potential
const HIGH_POTENTIAL_STATES = ['SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'DF', 'GO', 'BA', 'PE']

// Corporate email domains (non-free)
const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'yahoo.com',
  'outlook.com',
  'bol.com.br',
  'uol.com.br',
  'terra.com.br',
  'ig.com.br',
]

// Clinic types with high compounding medication demand
const HIGH_DEMAND_TYPES = [
  'dermatologia',
  'estética',
  'estetica',
  'endocrinologia',
  'ortomolecular',
  'ginecologia',
  'urologia',
  'nutrologia',
  'oncologia',
  'medicina integrativa',
]

function isFreeEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return FREE_EMAIL_DOMAINS.includes(domain)
}

function isHighDemandType(specialty: string | undefined): boolean {
  if (!specialty) return false
  const lower = specialty.toLowerCase()
  return HIGH_DEMAND_TYPES.some((t) => lower.includes(t))
}

function isCompleteAddress(formData: Record<string, string>): boolean {
  return !!(formData.address_line_1 && formData.city && formData.state && formData.zip_code)
}

function countFilledFields(formData: Record<string, string>): number {
  return Object.values(formData).filter((v) => v && String(v).trim().length > 0).length
}

/**
 * Calculate a lead score (0–100) for an incomplete registration draft.
 */
export function calculateLeadScore(formData: Record<string, string>): LeadScore {
  let score = 0
  const reasons: string[] = []

  // ── Form completeness (up to 30 pts) ─────────────────────────────────────
  const filledFields = countFilledFields(formData)
  if (filledFields >= 12) {
    score += 30
    reasons.push('Formulário completamente preenchido')
  } else if (filledFields >= 8) {
    score += 18
    reasons.push('Formulário majoritariamente preenchido')
  } else if (filledFields >= 5) {
    score += 8
    reasons.push('Formulário parcialmente preenchido')
  }

  // ── CNPJ present and valid format (up to 20 pts) ──────────────────────────
  const cnpj = formData.cnpj?.replace(/\D/g, '') ?? ''
  if (cnpj.length === 14) {
    score += 15
    reasons.push('CNPJ informado')
    // Bonus: CNPJ already validated externally (field cnpj_situation set)
    if (formData.cnpj_situation === 'ATIVA') {
      score += 5
      reasons.push('CNPJ ativo na Receita Federal')
    }
  }

  // ── High-potential state (10 pts) ─────────────────────────────────────────
  const state = formData.state?.toUpperCase() ?? ''
  if (HIGH_POTENTIAL_STATES.includes(state)) {
    score += 10
    reasons.push(`Estado de alto potencial (${state})`)
  }

  // ── Corporate email (10 pts) ──────────────────────────────────────────────
  const email = formData.email ?? ''
  if (email && !isFreeEmail(email)) {
    score += 10
    reasons.push('Email corporativo')
  }

  // ── High-demand clinic type (10 pts) ──────────────────────────────────────
  const specialty = formData.specialty ?? formData.clinic_type ?? formData.area
  if (isHighDemandType(specialty)) {
    score += 10
    reasons.push(`Especialidade de alta demanda (${specialty})`)
  }

  // ── Complete address (5 pts) ──────────────────────────────────────────────
  if (isCompleteAddress(formData)) {
    score += 5
    reasons.push('Endereço completo')
  }

  // ── Penalty: expired quickly (form_data missing phone or corporate name) ──
  if (!formData.phone) {
    score -= 5
    reasons.push('Sem telefone informado')
  }

  const finalScore = Math.max(0, Math.min(100, score))

  const level: LeadLevel = finalScore >= 60 ? 'hot' : finalScore >= 35 ? 'warm' : 'cold'

  return { score: finalScore, level, reasons }
}
