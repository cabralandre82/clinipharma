-- ============================================================
-- Migration 011: Self-registration flow
--   - registration_status em profiles
--   - registration_requests
--   - registration_documents
-- ============================================================

-- 1. Status de registro no perfil do usuário
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS registration_status text NOT NULL DEFAULT 'APPROVED'
  CHECK (registration_status IN ('PENDING', 'PENDING_DOCS', 'APPROVED', 'REJECTED'));

-- 2. Tabela principal de solicitações de cadastro
CREATE TABLE IF NOT EXISTS public.registration_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text        NOT NULL CHECK (type IN ('CLINIC', 'DOCTOR')),
  status        text        NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'PENDING_DOCS', 'APPROVED', 'REJECTED')),

  -- Dados do solicitante (armazenados como jsonb para flexibilidade por tipo)
  form_data     jsonb       NOT NULL DEFAULT '{}',

  -- Usuário criado na submissão
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Entidade criada na aprovação
  entity_id     uuid,       -- clinic_id ou doctor_id

  -- Ações do admin
  admin_notes   text,       -- motivo de reprovação ou observações
  requested_docs jsonb,     -- [{type, label, custom_text}]
  reviewed_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_status  ON public.registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_user_id ON public.registration_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_type    ON public.registration_requests(type);

-- auto updated_at
CREATE OR REPLACE FUNCTION public.set_reg_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reg_request_updated_at ON public.registration_requests;
CREATE TRIGGER trg_reg_request_updated_at
  BEFORE UPDATE ON public.registration_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_reg_request_updated_at();

-- 3. Documentos enviados na solicitação (ou em resposta a pedido de docs)
CREATE TABLE IF NOT EXISTS public.registration_documents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid        NOT NULL REFERENCES public.registration_requests(id) ON DELETE CASCADE,
  document_type text       NOT NULL,   -- 'CNPJ_CARD' | 'OPERATING_LICENSE' | 'RESPONSIBLE_ID' | 'CRM_CARD' | 'IDENTITY_DOC' | 'OTHER'
  label        text        NOT NULL,   -- label legível
  filename     text        NOT NULL,
  storage_path text        NOT NULL,
  public_url   text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_docs_request ON public.registration_documents(request_id);

-- 4. RLS
ALTER TABLE public.registration_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_documents ENABLE ROW LEVEL SECURITY;

-- Solicitante vê e atualiza sua própria solicitação
CREATE POLICY "Owner manages own request"
  ON public.registration_requests FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- SUPER_ADMIN/PLATFORM_ADMIN vê todas
CREATE POLICY "Admins view all requests"
  ON public.registration_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- SUPER_ADMIN pode atualizar (aprovar/reprovar)
CREATE POLICY "Super admin updates requests"
  ON public.registration_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN'
    )
  );

-- Service role full access
CREATE POLICY "Service role full requests"
  ON public.registration_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Docs: owner
CREATE POLICY "Owner manages own docs"
  ON public.registration_documents FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.registration_requests
      WHERE id = request_id AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.registration_requests
      WHERE id = request_id AND user_id = auth.uid()
    )
  );

-- Docs: admins
CREATE POLICY "Admins view all docs"
  ON public.registration_documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

CREATE POLICY "Service role full docs"
  ON public.registration_documents FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. Storage bucket para documentos de registro
INSERT INTO storage.buckets (id, name, public)
VALUES ('registration-documents', 'registration-documents', false)
ON CONFLICT (id) DO NOTHING;
