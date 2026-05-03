/**
 * Auth status helper — lê o flag escrito por `auth.setup.ts` para
 * decidir se a sessão autenticada está realmente disponível.
 *
 * Por que não basta `process.env.E2E_SUPER_ADMIN_PASSWORD`?
 *   Quando a senha está SETada mas o login FALHA (caso comum: senha
 *   de prod usada em CI contra staging, ou vice-versa), os testes
 *   autenticados precisam pular gracefully. O `auth.setup.ts` escreve
 *   um arquivo `no-auth.flag` em qualquer dos dois cenários
 *   (sem senha OU senha inválida), e os describes auth checam aqui.
 */
import path from 'path'
import fs from 'fs'

const NO_AUTH_FLAG = path.join(__dirname, '..', '.auth', 'no-auth.flag')

/** Returns true when the auth.setup.ts step succeeded with valid credential. */
export function hasAuthSession(): boolean {
  return !fs.existsSync(NO_AUTH_FLAG)
}
