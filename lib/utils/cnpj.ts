/**
 * CNPJ validator with full digit verification (Receita Federal algorithm).
 * Accepts formatted (XX.XXX.XXX/XXXX-XX) or raw (14 digits).
 */
export function validateCNPJ(cnpj: string): boolean {
  const raw = cnpj.replace(/\D/g, '')

  if (raw.length !== 14) return false

  // Block known invalid sequences
  if (/^(\d)\1+$/.test(raw)) return false

  function calcDigit(base: string, weights: number[]): number {
    let sum = 0
    for (let i = 0; i < weights.length; i++) {
      sum += parseInt(base[i]) * weights[i]
    }
    const rem = sum % 11
    return rem < 2 ? 0 : 11 - rem
  }

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  const d1 = calcDigit(raw, w1)
  const d2 = calcDigit(raw, w2)

  return parseInt(raw[12]) === d1 && parseInt(raw[13]) === d2
}

export function formatCNPJ(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}
