/**
 * Page Object Model — Login page.
 * Encapsulates selectors and actions for the login flow.
 */
import { type Page, type Locator, expect } from '@playwright/test'

export class LoginPage {
  readonly page: Page
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.emailInput = page.getByLabel(/e-?mail/i)
    this.passwordInput = page.getByLabel(/senha/i)
    this.submitButton = page.getByRole('button', { name: /entrar/i })
    this.errorMessage = page.getByRole('alert')
  }

  async goto() {
    await this.page.goto('/login')
    await expect(this.page).toHaveTitle(/clinipharma/i)
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }

  async expectError(message?: string) {
    if (message) {
      await expect(this.errorMessage).toContainText(message)
    } else {
      await expect(this.errorMessage).toBeVisible()
    }
  }
}
