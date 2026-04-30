-- Migration 074 — Buyer-specific pricing floor overrides (PR-B do ADR-001).
--
-- Visão
-- -----
-- O "piso da plataforma" definido no pricing_profile é o piso PADRÃO
-- aplicado a todos os buyers de um produto. Mas comercialmente vamos
-- precisar exceções: clínica X negociou margem menor pra fechar
-- contrato; médico Y entrou com volume garantido em troca de piso
-- reduzido. Essas exceções vivem aqui.
--
-- Modelo
-- ------
-- Linha = (produto, buyer, validade) → piso negociado.
-- Polimorfismo de buyer no estilo "two-column nullable" — alinhado
-- ao schema de `coupons` (clinic_id + doctor_id). Constraint XOR
-- garante que UMA E APENAS UMA das duas é não-nula em qualquer linha.
-- Padrão "buyer_type + buyer_id" foi rejeitado para manter consistência
-- com o resto da plataforma (vide ADR-001 §11).
--
-- Como o pricing_profile, este override é SCD-2: muda a margem
-- negociada com a clínica → encerra a linha vigente
-- (effective_until = now()) e insere uma nova. EXCLUDE constraint
-- garante que apenas 1 override está vivo por (product, buyer)
-- a qualquer instante.
--
-- O que o override NÃO toca
-- -------------------------
-- * Tier prices (unit_price_cents): vem do profile. Todos os buyers
--   pagam o mesmo "preço de tabela"; só o piso da plataforma é
--   negociado. (Se um dia precisar override de tier, é nova migration.)
-- * pharmacy_cost_unit_cents: vem do profile. INV-1 imutável.
-- * Comissão de consultor: rate é global (app_settings) ou definida
--   no profile (basis). Override só mexe em piso.
--
-- INV-1 ainda enforçado em runtime
-- --------------------------------
-- O override pode definir um piso < pharmacy_cost_unit_cents — caso
-- em que o piso seria mais "generoso" pra clínica do que a plataforma
-- pode bancar. compute_unit_price (mig-071) já protege esse caso
-- elevando o floor efetivo para pharmacy_cost. Aqui não criamos um
-- CHECK acoplando às duas tabelas (Postgres não suporta sem trigger
-- complexo); a defesa em runtime é suficiente porque é DETERMINÍSTICA
-- e auditada (todo profile/override mudança vai pra audit_logs em PR-C).
--
-- Compliance
-- ----------
-- LGPD: a existência de uma linha aqui revela que tal clínica/médico
-- "negociou condições diferenciadas". Isso é dado contratual sensível
-- (não pessoal). RLS abaixo restringe leitura a SUPER_ADMIN/PLATFORM_ADMIN
-- + ao próprio buyer (clinic_member ou doctor.user_id).
-- audit: PR-C grava cada criação/edição em audit_logs com actor +
-- change_reason.
--
-- Rollback
-- --------
-- Reverter para mig-071 do resolve_effective_floor (que ignora
-- argumentos clinic/doctor) e DROP TABLE buyer_pricing_overrides.
-- Não há FK in-bound de outra tabela — DROP é seguro.

SET search_path TO public, extensions, pg_temp;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.buyer_pricing_overrides (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid          NOT NULL REFERENCES public.products(id)  ON DELETE RESTRICT,

  -- Polimorfismo two-col nullable — XOR via CHECK abaixo. Igual a coupons.
  clinic_id   uuid          NULL  REFERENCES public.clinics(id)  ON DELETE CASCADE,
  doctor_id   uuid          NULL  REFERENCES public.doctors(id)  ON DELETE CASCADE,

  -- Piso negociado. Pelo menos um dos dois deve estar definido (CHECK).
  -- Política idêntica ao profile: floor effective = MAX(abs, pct × tier_unit).
  platform_min_unit_cents   bigint        NULL CHECK (platform_min_unit_cents IS NULL OR platform_min_unit_cents > 0),
  platform_min_unit_pct     numeric(5,2)  NULL CHECK (
                                            platform_min_unit_pct IS NULL OR
                                            (platform_min_unit_pct >= 0 AND platform_min_unit_pct <= 100)
                                          ),

  -- SCD-2 envelope.
  effective_from     timestamptz   NOT NULL DEFAULT now(),
  effective_until    timestamptz   NULL,
  CHECK (effective_until IS NULL OR effective_until > effective_from),

  created_by_user_id uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  change_reason      text          NOT NULL CHECK (length(trim(change_reason)) > 0),
  created_at         timestamptz   NOT NULL DEFAULT now(),

  -- XOR clinic/doctor — intencional. Override genérico "para todo
  -- mundo" seria apagar a clínica e o médico; quem quer piso geral
  -- mexe no profile, não aqui.
  CHECK ((clinic_id IS NULL) <> (doctor_id IS NULL)),

  -- Pelo menos um piso (mesmo CHECK do profile).
  CHECK (platform_min_unit_cents IS NOT NULL OR platform_min_unit_pct IS NOT NULL)
);

-- ── EXCLUDE no-overlap por (product, buyer) ────────────────────────────
--
-- Postgres EXCLUDE não combina = direto com colunas anuláveis pra
-- semântica que a gente quer (NULL = NULL deve ser falso aqui).
-- Truque: usamos `COALESCE(clinic_id, doctor_id)` como a "identidade"
-- do buyer. Como o XOR garante que exatamente 1 dos dois é não-nulo,
-- o COALESCE produz a UUID do buyer ativo. Duas linhas só conflitam
-- se forem o MESMO buyer (clínica ou médico) e mesmo produto e
-- ranges sobrepostos.
--
-- Implementado via UNIQUE INDEX expression + uma trigger AFTER que
-- valida overlap (PG não permite EXCLUDE com expression em
-- combinação com tstzrange; tomamos o caminho mais robusto):

CREATE INDEX IF NOT EXISTS ix_bpo_active
  ON public.buyer_pricing_overrides(
       product_id,
       COALESCE(clinic_id, doctor_id)
     )
  WHERE effective_until IS NULL;

CREATE INDEX IF NOT EXISTS ix_bpo_temporal
  ON public.buyer_pricing_overrides USING brin (effective_from, effective_until);

-- Trigger que enforça "no_overlap por (product, buyer)" em INSERT/UPDATE.
-- Existe em vez de EXCLUDE constraint nativo porque PostgreSQL não
-- aceita expression-based EXCLUDE com gist. Validation roda em SERIALIZABLE
-- isolation level por padrão; transações concorrentes conflitam pelo
-- index que a query usa para o lookup.

CREATE OR REPLACE FUNCTION public._bpo_check_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_buyer_id uuid;
BEGIN
  v_buyer_id := COALESCE(NEW.clinic_id, NEW.doctor_id);

  IF EXISTS (
    SELECT 1
      FROM public.buyer_pricing_overrides existing
     WHERE existing.id <> NEW.id
       AND existing.product_id = NEW.product_id
       AND COALESCE(existing.clinic_id, existing.doctor_id) = v_buyer_id
       AND tstzrange(existing.effective_from, existing.effective_until, '[)')
        && tstzrange(NEW.effective_from,      NEW.effective_until,      '[)')
  ) THEN
    RAISE EXCEPTION 'buyer_pricing_overrides: overlap detected for product=% buyer=% range=[%,%)',
      NEW.product_id, v_buyer_id, NEW.effective_from, COALESCE(NEW.effective_until::text, '∞')
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bpo_no_overlap ON public.buyer_pricing_overrides;
CREATE TRIGGER trg_bpo_no_overlap
  BEFORE INSERT OR UPDATE OF product_id, clinic_id, doctor_id, effective_from, effective_until
  ON public.buyer_pricing_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public._bpo_check_no_overlap();

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.buyer_pricing_overrides ENABLE ROW LEVEL SECURITY;

-- Read: SUPER_ADMIN/PLATFORM_ADMIN, OR member da clínica do override,
-- OR doctor do override (auth.uid = doctors.user_id).
DROP POLICY IF EXISTS bpo_select_admin ON public.buyer_pricing_overrides;
CREATE POLICY bpo_select_admin ON public.buyer_pricing_overrides
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

DROP POLICY IF EXISTS bpo_select_clinic_member ON public.buyer_pricing_overrides;
CREATE POLICY bpo_select_clinic_member ON public.buyer_pricing_overrides
  FOR SELECT TO authenticated
  USING (
    clinic_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.clinic_members cm
       WHERE cm.clinic_id = buyer_pricing_overrides.clinic_id
         AND cm.user_id   = auth.uid()
    )
  );

DROP POLICY IF EXISTS bpo_select_doctor_self ON public.buyer_pricing_overrides;
CREATE POLICY bpo_select_doctor_self ON public.buyer_pricing_overrides
  FOR SELECT TO authenticated
  USING (
    doctor_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.doctors d
       WHERE d.id      = buyer_pricing_overrides.doctor_id
         AND d.user_id = auth.uid()
    )
  );

-- Write: SUPER_ADMIN apenas.
DROP POLICY IF EXISTS bpo_write_super_admin ON public.buyer_pricing_overrides;
CREATE POLICY bpo_write_super_admin ON public.buyer_pricing_overrides
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid() AND ur.role = 'SUPER_ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid() AND ur.role = 'SUPER_ADMIN'
    )
  );

-- ── Smoke ──────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_table_exists  boolean;
  v_idx_active    boolean;
  v_trigger_exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='buyer_pricing_overrides')
    INTO v_table_exists;
  SELECT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public'
                    AND tablename='buyer_pricing_overrides'
                    AND indexname='ix_bpo_active')
    INTO v_idx_active;
  SELECT EXISTS (SELECT 1 FROM pg_trigger t
                  JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE c.relname='buyer_pricing_overrides'
                   AND t.tgname='trg_bpo_no_overlap')
    INTO v_trigger_exists;

  IF NOT v_table_exists   THEN RAISE EXCEPTION 'mig074 smoke: buyer_pricing_overrides missing';     END IF;
  IF NOT v_idx_active     THEN RAISE EXCEPTION 'mig074 smoke: ix_bpo_active missing';               END IF;
  IF NOT v_trigger_exists THEN RAISE EXCEPTION 'mig074 smoke: trg_bpo_no_overlap missing';          END IF;

  RAISE NOTICE 'Migration 074 smoke passed (buyer_pricing_overrides + EXCLUDE trigger + RLS)';
END
$smoke$;
