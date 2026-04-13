/**
 * Determines whether the "requesting doctor" field should be shown and/or
 * required when placing an order.
 *
 * Rules:
 * - No linked doctors → field is hidden (clinic has no doctors at all)
 * - Has linked doctors + no prescription product in cart → optional
 * - Has linked doctors + at least one prescription product in cart → required
 */
export function resolveDoctorFieldState(
  cartItems: { requires_prescription: boolean }[],
  linkedDoctors: unknown[]
): { show: boolean; required: boolean } {
  if (linkedDoctors.length === 0) return { show: false, required: false }
  const required = cartItems.some((item) => item.requires_prescription)
  return { show: true, required }
}
