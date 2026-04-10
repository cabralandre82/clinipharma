import { NextResponse } from 'next/server'

/**
 * Standardized API response shape.
 * All API routes should return responses through these helpers.
 *
 * Success shape:  { data: T, meta: { requestId, timestamp, version } }
 * Error shape:    { error: { code, message }, meta: { requestId, timestamp, version } }
 */

const API_VERSION = 'v1'

export interface ApiMeta {
  requestId: string
  timestamp: string
  version: string
}

export interface ApiSuccessResponse<T> {
  data: T
  meta: ApiMeta
}

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
  meta: ApiMeta
}

function buildMeta(requestId?: string): ApiMeta {
  return {
    requestId: requestId ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    version: API_VERSION,
  }
}

/** Return a successful JSON response with standard shape. */
export function apiSuccess<T>(
  data: T,
  options?: {
    status?: number
    requestId?: string
    headers?: Record<string, string>
  }
): NextResponse<ApiSuccessResponse<T>> {
  const meta = buildMeta(options?.requestId)
  return NextResponse.json(
    { data, meta },
    {
      status: options?.status ?? 200,
      headers: {
        'X-Request-ID': meta.requestId,
        ...options?.headers,
      },
    }
  )
}

/** Return an error JSON response with standard shape. */
export function apiError(
  code: string,
  message: string,
  status: number,
  options?: { requestId?: string }
): NextResponse<ApiErrorResponse> {
  const meta = buildMeta(options?.requestId)
  return NextResponse.json(
    { error: { code, message }, meta },
    {
      status,
      headers: { 'X-Request-ID': meta.requestId },
    }
  )
}

// ── Common error factories ────────────────────────────────────────────────────

export const ApiErrors = {
  unauthorized: (requestId?: string) =>
    apiError('UNAUTHORIZED', 'Não autenticado', 401, { requestId }),

  forbidden: (requestId?: string) => apiError('FORBIDDEN', 'Sem permissão', 403, { requestId }),

  notFound: (resource = 'Recurso', requestId?: string) =>
    apiError('NOT_FOUND', `${resource} não encontrado`, 404, { requestId }),

  badRequest: (message: string, requestId?: string) =>
    apiError('BAD_REQUEST', message, 400, { requestId }),

  conflict: (message: string, requestId?: string) =>
    apiError('CONFLICT', message, 409, { requestId }),

  tooManyRequests: (requestId?: string) =>
    apiError('RATE_LIMITED', 'Muitas requisições. Tente novamente em breve.', 429, { requestId }),

  internal: (requestId?: string) =>
    apiError('INTERNAL_ERROR', 'Erro interno do servidor', 500, { requestId }),

  serviceUnavailable: (service: string, requestId?: string) =>
    apiError('SERVICE_UNAVAILABLE', `Serviço ${service} temporariamente indisponível`, 503, {
      requestId,
    }),
}
