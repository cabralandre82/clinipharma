import { Metadata } from 'next'
import { ForgotPasswordForm } from './forgot-password-form'

export const metadata: Metadata = {
  title: 'Recuperar senha',
}

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">Recuperar senha</h2>
        <p className="mt-1 text-sm text-gray-500">
          Informe seu email e enviaremos um link de recuperação
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  )
}
