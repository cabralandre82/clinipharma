/**
 * Page Object Model — Admin pages (registration requests, clinics, pharmacies).
 */
import { type Page, type Locator, expect } from '@playwright/test'

export class RegistrationRequestsPage {
  readonly page: Page
  readonly heading: Locator
  readonly pendingTab: Locator
  readonly requestRows: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /cadastros|solicitações/i })
    this.pendingTab = page.getByRole('tab', { name: /pendentes?/i })
    this.requestRows = page.locator('[data-testid="request-row"], tbody tr')
  }

  async goto() {
    await this.page.goto('/admin/registrations')
    await expect(this.heading).toBeVisible({ timeout: 10_000 })
  }

  async approveFirst() {
    const approveButton = this.requestRows.first().getByRole('button', { name: /aprovar/i })
    await approveButton.click()
    // Confirm dialog if present
    const confirmButton = this.page.getByRole('button', { name: /confirmar|sim/i })
    if (await confirmButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmButton.click()
    }
  }

  async rejectFirst(reason?: string) {
    const rejectButton = this.requestRows
      .first()
      .getByRole('button', { name: /reprovar|rejeitar/i })
    await rejectButton.click()
    if (reason) {
      await this.page.getByLabel(/motivo/i).fill(reason)
    }
    const confirmButton = this.page.getByRole('button', { name: /confirmar|sim/i })
    if (await confirmButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmButton.click()
    }
  }
}

export class PharmaciesPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto() {
    await this.page.goto('/admin/pharmacies')
  }

  async updateFirstOrderStatus(newStatus: string) {
    const statusSelect = this.page.locator('select[name="order_status"]').first()
    await statusSelect.selectOption({ label: newStatus })
    const saveButton = this.page.getByRole('button', { name: /salvar|atualizar/i }).first()
    await saveButton.click()
  }
}
