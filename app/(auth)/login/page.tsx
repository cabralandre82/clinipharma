import { Metadata } from 'next'
import { Suspense } from 'react'
import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Login',
}

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">Acessar plataforma</h2>
        <p className="mt-1 text-sm text-gray-500">Entre com suas credenciais para continuar</p>
      </div>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-gray-100" />}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
