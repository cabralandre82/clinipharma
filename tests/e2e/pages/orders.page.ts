/**
 * Page Object Model — Orders pages.
 */
import { type Page, type Locator, expect } from '@playwright/test'

export class OrdersListPage {
  readonly page: Page
  readonly heading: Locator
  readonly newOrderButton: Locator
  readonly orderRows: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /pedidos/i })
    this.newOrderButton = page.getByRole('link', { name: /novo pedido/i })
    this.orderRows = page.locator('[data-testid="order-row"], tbody tr')
  }

  async goto() {
    await this.page.goto('/orders')
    await expect(this.heading).toBeVisible({ timeout: 10_000 })
  }
}

export class NewOrderPage {
  readonly page: Page
  readonly clinicSelect: Locator
  readonly doctorSelect: Locator
  readonly productSearch: Locator
  readonly quantityInput: Locator
  readonly notesTextarea: Locator
  readonly submitButton: Locator
  readonly successMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.clinicSelect = page.getByLabel(/clínica/i)
    this.doctorSelect = page.getByLabel(/médico/i)
    this.productSearch = page.getByPlaceholder(/buscar produto/i)
    this.quantityInput = page.getByLabel(/quantidade/i)
    this.notesTextarea = page.getByLabel(/observações|notas/i)
    this.submitButton = page.getByRole('button', { name: /criar pedido|confirmar/i })
    this.successMessage = page.getByText(/pedido criado|pedido.*sucesso/i)
  }

  async goto() {
    await this.page.goto('/orders/new')
  }

  async fillAndSubmit(options: {
    clinicName?: string
    doctorName?: string
    productName?: string
    quantity?: string
    notes?: string
  }) {
    const { clinicName, doctorName, productName, quantity = '1', notes } = options

    if (clinicName) {
      await this.clinicSelect.click()
      await this.page.getByRole('option', { name: new RegExp(clinicName, 'i') }).click()
    }

    if (doctorName) {
      await this.doctorSelect.click()
      await this.page.getByRole('option', { name: new RegExp(doctorName, 'i') }).click()
    }

    if (productName) {
      await this.productSearch.fill(productName)
      await this.page
        .getByRole('option', { name: new RegExp(productName, 'i') })
        .first()
        .click()
    }

    await this.quantityInput.fill(quantity)

    if (notes) {
      await this.notesTextarea.fill(notes)
    }

    await this.submitButton.click()
  }
}
