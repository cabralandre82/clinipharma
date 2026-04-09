import { ResetPasswordForm } from './reset-password-form'

export const metadata = { title: 'Redefinir senha — Clinipharma' }

export default function ResetPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Nova senha</h1>
        <p className="text-sm text-gray-500">Digite e confirme sua nova senha.</p>
      </div>
      <ResetPasswordForm />
    </div>
  )
}
