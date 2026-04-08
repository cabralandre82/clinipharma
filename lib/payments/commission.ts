export interface CommissionResult {
  grossAmount: number
  commissionPercentage: number
  commissionAmount: number
  netAmount: number
}

/**
 * Calculates commission based on gross amount and percentage.
 * Values are rounded to 2 decimal places.
 */
export function calculateCommission(
  grossAmount: number,
  commissionPercentage: number
): CommissionResult {
  if (grossAmount < 0) throw new Error('Gross amount cannot be negative')
  if (commissionPercentage < 0 || commissionPercentage > 100) {
    throw new Error('Commission percentage must be between 0 and 100')
  }

  const commissionAmount = Math.round(grossAmount * (commissionPercentage / 100) * 100) / 100
  const netAmount = Math.round((grossAmount - commissionAmount) * 100) / 100

  return {
    grossAmount,
    commissionPercentage,
    commissionAmount,
    netAmount,
  }
}

/**
 * Calculates net amount (what pharmacy receives) after fixed commission.
 */
export function calculateNetFromFixed(
  grossAmount: number,
  fixedCommission: number
): CommissionResult {
  if (grossAmount < 0) throw new Error('Gross amount cannot be negative')
  if (fixedCommission < 0) throw new Error('Fixed commission cannot be negative')
  if (fixedCommission > grossAmount) throw new Error('Commission cannot exceed gross amount')

  const netAmount = Math.round((grossAmount - fixedCommission) * 100) / 100
  const percentage = Math.round((fixedCommission / grossAmount) * 100 * 100) / 100

  return {
    grossAmount,
    commissionPercentage: percentage,
    commissionAmount: fixedCommission,
    netAmount,
  }
}
