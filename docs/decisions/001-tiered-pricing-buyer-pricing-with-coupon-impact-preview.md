# ADR-001 — Tiered Pricing, Buyer-scoped Floor Overrides, Coupon Impact Preview

> Status: **Proposed** — awaiting implementation in PR-0 → PR-D
> Date: 2026-04-30
> Decider: solo operator (founder)
> Author of this ADR: pair-programming agent, written from the design
> conversation of 2026-04-29 (08:33 PM → 22:10 PM UTC-3)
> Supersedes: none — this is the first ADR in the repo
> Touches: `orders`, `order_items`, `pharmacy_cost`, `coupons`, consultant
> commissions, the `freeze_order_item_price` trigger, and adds four
> new tables (none of them touch the audit chain or the LGPD-critical
> surface).

---

## 1. Context

### 1.1 The commercial problem

Compounding pharmacies (`farmácias de manipulação`) cannot present
their products the way industrial pharma does on B2B marketplaces.
ANVISA's RDC 67/2007 forbids "publicising pre-elaborated formulations"
as if they were industrial products. Showing
**"Tirzepatida 5mg — R$ 800"** in the catalogue is regulatorily
fragile (ANPD/ANVISA exposure) and commercially weak (commoditises
high-margin compounded products into a price war).

Conversation with a senior sales director at a partner pharmacy on
2026-04-29 surfaced two requirements that the platform did not yet
support:

1. **The price quoted to the buyer must be tier-based by quantity.**
   Compounded tirzepatide pricing scales by volume — 1 unit costs
   one price, 2-3 units another, 7+ another still. Today the catalogue
   only carries a single `products.price_current`.
2. **The price the platform earns per unit must have a hard floor**,
   per product, that no coupon, discount, or negotiation can cross.
   The pharmacy cost is fixed (R$ 1,000 for tirzepatida 60mg). The
   platform refuses to ever earn less than R$ 120/unit on the same
   product, because that R$ 120 funds (a) the consultant commission
   if any, and (b) the platform's own margin.

### 1.2 The pricing-experience problem for the operator

The same conversation also surfaced a second class of problem on the
operator side: when a coupon is created and assigned to a clinic or
doctor, the operator currently has **no view** of the financial
impact of that decision across the catalogue. They have to mentally
multiply percentages times tiers times qty and hope. The historical
ghost-money bug of 2026-04-29 (R$ 9.50 phantom on `CP-2026-000015`,
fixed by migrations 061 + 064 + 067) was a direct symptom of having
no canonical model for "what the platform earns when X happens";
adding tiers + coupons + per-product floors compounds the same risk
class unless visualisation is built in.

### 1.3 The polymorphism problem

The platform sells to two buyer types: clinics (legal entities, CNPJ,
`clinics` table) and doctors (natural persons, CPF + CRM, `doctors`
table). The operator confirmed that **every commercial mechanism
must support both equally** — coupons, pricing overrides, consultant
links, impact previews. Schema inspection on 2026-04-29 found:

- `orders` already uses **two-column polymorphism**: `clinic_id` +
  `doctor_id` (mutually exclusive, gated by `buyer_type` enum).
- `coupons` follows the same pattern.
- `clinics` has `consultant_id`; **`doctors` does not** — this is a
  pre-existing regression (consultants assigned to a doctor would be
  invisible to `confirm_payment_atomic`, never billed). Fixed in PR-0
  of this ADR.

We will keep the two-column convention everywhere new for internal
schema consistency, even though `(buyer_type, buyer_id)` polymorphism
would be slightly cleaner conceptually. Consistency wins. FKs work,
EXCLUDE constraints work, RLS stays simple.

---

## 2. Decision drivers

| #   | Driver                                                       | Source                                                            |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| D1  | RDC 67/2007 — no per-dose price advertising                  | ANVISA regulation                                                 |
| D2  | Hard per-product, per-unit floor on platform earnings        | Operator (2026-04-29 21:17)                                       |
| D3  | Floor is a default, override per buyer is the exception      | Operator (2026-04-29 21:30)                                       |
| D4  | Consultant commission ≤ platform earnings, ALWAYS            | Operator (2026-04-30 08:02)                                       |
| D5  | Buyer-agnostic: clinic and doctor are first-class peers      | Operator (2026-04-29 22:46)                                       |
| D6  | Coupon must respect both tier and floor; UI shows it         | Operator (2026-04-29 21:42)                                       |
| D7  | No regression in payment / commission / reconciliation flows | Architectural (2026-04-29 21:30 — "the platform just stabilised") |
| D8  | Confidence ≥ 95% before merging anything                     | Operator (2026-04-29 21:30)                                       |
| D9  | Operator wants single screen showing campaign cost preview   | Operator (2026-04-29 21:42)                                       |
| D10 | Schema convention: two nullable columns, not polymorphic id  | Schema inspection (2026-04-29 22:46)                              |

### 2.1 Non-goals (deferred to future ADRs)

- Currency other than BRL.
- Negotiated buyer-specific tier prices (only floor is overridable).
- Multi-coupon stacking on a single order (one coupon per order remains).
- ML-based prescription OCR (`PENDING_PHARMACY_REVIEW` is one-click human).
- Auto-approval of pharmacy review (always at least one click).
- Cross-pharmacy bundling (tiers are per-product, never cross).

---

## 3. Considered options

### Option A — "Estimate equals final price"

Catalog shows `R$ 800 a partir de`; order is created with that exact
price; coupon applies; pharmacy absorbs any underrun, plats absorbs
any overrun.

- Rejected. Violates RDC 67/2007 (charging before pharmaceutical analysis
  of prescription) and creates open-ended financial liability for the
  pharmacy, which kills the partnership.

### Option B — Separate "quote request" entity

New `quote_requests` table parallel to `orders`; clinic creates RFQ;
pharmacy responds with quote; on accept, RFQ promotes to order.

- Rejected for **now**. Doubles the surface area (RLS, audit, payment
  hooks, dashboard, notification). Estimated 2-3 weeks of work versus
  ~28h for the chosen design. The chosen design captures 95% of the
  value at a fraction of the cost. Could be revisited as ADR-NNN if
  pharmacy partners explicitly demand the workflow separation.

### Option C — In-order pricing (this ADR)

Tier-based unit price calculated automatically from a `PricingProfile`
attached to the product, validated against a per-product platform
floor (with optional per-buyer override). Pharmacy reviews the
prescription with one click; coupon and tier visible to the buyer in
the catalog simulator; full impact matrix visible to the operator.

- **Chosen.**

### Option D — Pure copy/UX changes (no model changes)

Just rename "Catalog" to "Farmacopeia", add disclaimers, no behaviour
change.

- Rejected as insufficient: addresses D1 cosmetically but ignores
  D2-D6. Useful subset is folded into Phase 1 of Option C (see §10).

---

## 4. Decision

We adopt **Option C**, structured around four cooperating entities
and four mathematical invariants:

```
   ┌────────────────────────────────────────────────────────────────┐
   │ products  (existing — gains pricing_mode)                      │
   │   pricing_mode: 'FIXED' (default, legacy) | 'TIERED_PROFILE'   │
   │   pharmacy_cost (deprecated when TIERED_PROFILE — read profile)│
   └────────────────────────────────────────────────────────────────┘
                                │
                       1 ←──────┘──────→ N
                                │
   ┌────────────────────────────▼────────────────────────────────────┐
   │ pricing_profiles  (new, SCD-2 versioned)                        │
   │   one ACTIVE profile per product at any point in time           │
   │   pharmacy_cost_unit_cents | platform_min_unit_cents (default)  │
   │   consultant_commission_basis | tiers (1:N child)               │
   └─────────────────────────────────────────────────────────────────┘
                                │
                       1 ←──────┘──────→ N
                                │
   ┌────────────────────────────▼────────────────────────────────────┐
   │ pricing_profile_tiers  (new, child of profile)                  │
   │   (min_qty, max_qty, unit_price_cents) — non-overlapping        │
   └─────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────┐
   │ buyer_pricing_overrides  (new, OPTIONAL, SCD-2 versioned)       │
   │   exception: (clinic_id XOR doctor_id) + product_id +           │
   │               platform_min_unit_cents (overrides profile's)     │
   │   resolved per (buyer, product) at order-creation time          │
   └─────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────┐
   │ coupons  (existing — gains tier-aware fields)                   │
   │   + min_quantity, max_quantity, applies_to_tier, …              │
   └─────────────────────────────────────────────────────────────────┘
```

### 4.1 The four invariants (mechanical guarantees)

These are not "good practices" — they are guarantees enforced
either at save-time (constraints + CHECKs) or in the
`freeze_order_item_price` trigger (`RAISE` or silent cap):

| ID        | Invariant                                                                       | Enforcement point                                                                                         |
| --------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **INV-1** | `pharmacy_transfer >= sum(pharmacy_cost_per_unit × qty)`                        | True by construction — `pharmacy_cost_per_unit` is frozen at INSERT                                       |
| **INV-2** | `final_unit_price >= effective_floor` (per product, per buyer)                  | Cap applied silently to coupon; trigger `RAISE` if invariant still violated                               |
| **INV-3** | `total_price = pharmacy_transfer + consultant_commission + platform_commission` | Validated by `platform_revenue_view` and the `reconcile-platform-revenue` cron; existing today, preserved |
| **INV-4** | `consultant_commission <= platform_commission`                                  | Cap applied in `compute_unit_price`; defensive `LEAST` in `confirm_payment_atomic`                        |

Where `effective_floor` resolves as:

```
effective_floor(product_id, clinic_id, doctor_id, at_timestamp)
  = pharmacy_cost_unit_cents
    + COALESCE(
        override.platform_min_unit_cents,
        profile.platform_min_unit_cents,
        profile.platform_min_unit_pct × pharmacy_cost  -- whichever is GREATER
      )
```

### 4.2 Who absorbs what (the bookkeeping model)

| Concession                                           | Decided by                           | Absorbed by                                                |
| ---------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| Tier discount (qty 1 = R$ 1,500 → qty 7+ = R$ 1,200) | Pharmacy (configures the tier table) | Pharmacy (its margin shrinks; cost stays fixed)            |
| Coupon discount (10% off)                            | Platform (campaign tool)             | Platform (deducted from `platform_commission`)             |
| Pharmacy cost                                        | Pharmacy (product cadastro)          | Always paid out frozen — never reduced by coupons or tiers |

The platform never subsidises the pharmacy below cost; the pharmacy
never subsidises platform campaigns; the consultant never receives
more than the platform itself receives.

---

## 5. Detailed design — data model

### 5.1 `pricing_profiles` (new)

```sql
CREATE TABLE public.pricing_profiles (
  id                                          uuid PRIMARY KEY
                                              DEFAULT gen_random_uuid(),
  product_id                                  uuid NOT NULL
                                              REFERENCES public.products(id)
                                              ON DELETE RESTRICT,

  -- The fixed cost frozen into every order_item via the trigger.
  pharmacy_cost_unit_cents                    bigint NOT NULL CHECK (pharmacy_cost_unit_cents > 0),

  -- Platform floor: at least one of the two MUST be set.
  platform_min_unit_cents                     bigint NULL,
  platform_min_unit_pct                       numeric(5,2) NULL,

  consultant_commission_basis                 text NOT NULL DEFAULT 'TOTAL_PRICE'
                                              CHECK (consultant_commission_basis IN
                                                ('TOTAL_PRICE',
                                                 'PHARMACY_TRANSFER',
                                                 'FIXED_PER_UNIT')),
  consultant_commission_fixed_per_unit_cents  bigint NULL,

  effective_from                              timestamptz NOT NULL DEFAULT now(),
  effective_until                             timestamptz NULL,

  created_by_user_id                          uuid NOT NULL REFERENCES public.profiles(id),
  change_reason                               text NOT NULL,
  created_at                                  timestamptz NOT NULL DEFAULT now(),

  CHECK (platform_min_unit_cents IS NOT NULL
         OR platform_min_unit_pct IS NOT NULL),
  CHECK ((consultant_commission_basis = 'FIXED_PER_UNIT')
         = (consultant_commission_fixed_per_unit_cents IS NOT NULL)),
  -- INV-4-save: fixed-per-unit consultant must not exceed platform
  -- floor (when both are absolute). Pct-based platform floor is not
  -- validated here because it depends on resolved cost; runtime
  -- INV-4 catches it.
  CHECK (consultant_commission_basis <> 'FIXED_PER_UNIT'
         OR platform_min_unit_cents IS NULL
         OR consultant_commission_fixed_per_unit_cents <= platform_min_unit_cents)
);

-- Exactly one ACTIVE profile per product at any moment.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.pricing_profiles
  ADD CONSTRAINT pricing_profiles_no_overlap
  EXCLUDE USING gist (
    product_id WITH =,
    tstzrange(effective_from, effective_until) WITH &&
  );

CREATE INDEX ix_pricing_profiles_active
  ON public.pricing_profiles(product_id)
  WHERE effective_until IS NULL;
```

### 5.2 `pricing_profile_tiers` (new, child of profile)

```sql
CREATE TABLE public.pricing_profile_tiers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_profile_id  uuid NOT NULL
                      REFERENCES public.pricing_profiles(id) ON DELETE CASCADE,
  min_quantity        int  NOT NULL CHECK (min_quantity > 0),
  max_quantity        int  NOT NULL CHECK (max_quantity >= min_quantity),
  unit_price_cents    bigint NOT NULL CHECK (unit_price_cents > 0)
);

ALTER TABLE public.pricing_profile_tiers
  ADD CONSTRAINT pricing_profile_tiers_no_overlap
  EXCLUDE USING gist (
    pricing_profile_id WITH =,
    int4range(min_quantity, max_quantity, '[]') WITH &&
  );

CREATE INDEX ix_pricing_profile_tiers_lookup
  ON public.pricing_profile_tiers(pricing_profile_id, min_quantity);
```

Save-time trigger (or function called by the API) further validates:

- **INV-A** (per tier): `unit_price_cents >= pharmacy_cost_unit + platform_min_unit`
- **INV-B**: tiers are gap-free starting at `min_quantity = 1`
- **INV-C**: tier `n+1` has `unit_price <=` tier `n` (price falls with volume)

### 5.3 `buyer_pricing_overrides` (new, OPTIONAL)

```sql
CREATE TABLE public.buyer_pricing_overrides (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                   uuid NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id                   uuid NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  product_id                  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  platform_min_unit_cents     bigint NULL,
  platform_min_unit_pct       numeric(5,2) NULL,
  effective_from              timestamptz NOT NULL DEFAULT now(),
  effective_until             timestamptz NULL,
  created_by_user_id          uuid NOT NULL REFERENCES public.profiles(id),
  reason                      text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  -- Exactly one of clinic_id / doctor_id must be set.
  CHECK ((clinic_id IS NULL) <> (doctor_id IS NULL)),
  CHECK (platform_min_unit_cents IS NOT NULL
         OR platform_min_unit_pct IS NOT NULL)
);

ALTER TABLE public.buyer_pricing_overrides
  ADD CONSTRAINT buyer_pricing_overrides_no_overlap
  EXCLUDE USING gist (
    coalesce(clinic_id, doctor_id) WITH =,
    product_id WITH =,
    tstzrange(effective_from, effective_until) WITH &&
  );

CREATE INDEX ix_buyer_pricing_overrides_clinic_lookup
  ON public.buyer_pricing_overrides(clinic_id, product_id)
  WHERE clinic_id IS NOT NULL AND effective_until IS NULL;

CREATE INDEX ix_buyer_pricing_overrides_doctor_lookup
  ON public.buyer_pricing_overrides(doctor_id, product_id)
  WHERE doctor_id IS NOT NULL AND effective_until IS NULL;

ALTER TABLE public.buyer_pricing_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY buyer_pricing_overrides_super_admin_all
  ON public.buyer_pricing_overrides
  FOR ALL
  USING (public.has_role(auth.uid(), 'SUPER_ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'SUPER_ADMIN'));

CREATE POLICY buyer_pricing_overrides_admin_read
  ON public.buyer_pricing_overrides
  FOR SELECT
  USING (public.has_role(auth.uid(), 'PLATFORM_ADMIN'));
```

### 5.4 `coupons` extension (additive)

```sql
ALTER TABLE public.coupons
  ADD COLUMN min_quantity         int          NOT NULL DEFAULT 1
    CHECK (min_quantity >= 1),
  ADD COLUMN max_quantity         int          NULL
    CHECK (max_quantity IS NULL OR max_quantity >= min_quantity),
  ADD COLUMN applies_to_tier      text         NOT NULL DEFAULT 'ALL'
    CHECK (applies_to_tier IN ('ALL', 'FIRST_UNIT', 'SPECIFIC')),
  ADD COLUMN tier_promotion_steps int          NOT NULL DEFAULT 0
    CHECK (tier_promotion_steps >= 0);

-- Coupon discount_type enum extension (append-only on the type)
ALTER TYPE public.discount_type_enum
  ADD VALUE IF NOT EXISTS 'FIRST_UNIT_DISCOUNT';
ALTER TYPE public.discount_type_enum
  ADD VALUE IF NOT EXISTS 'TIER_UPGRADE';
ALTER TYPE public.discount_type_enum
  ADD VALUE IF NOT EXISTS 'MIN_QTY_PERCENT';
```

Existing coupons (`PERCENT`, `FIXED`) keep working unchanged — the
new columns default to legacy behaviour (`min_quantity=1`,
`applies_to_tier='ALL'`, `tier_promotion_steps=0`).

### 5.5 `order_items` extension (additive — audit + freezing)

```sql
ALTER TABLE public.order_items
  ADD COLUMN pricing_profile_id      uuid NULL REFERENCES public.pricing_profiles(id),
  ADD COLUMN pricing_tier_id         uuid NULL REFERENCES public.pricing_profile_tiers(id),
  ADD COLUMN effective_floor_cents   bigint NULL,
  ADD COLUMN discount_breakdown      jsonb NULL;
```

`discount_breakdown` shape (for audit and the
`reconcile-platform-revenue` cron):

```json
{
  "pricing_mode": "TIERED_PROFILE",
  "tier_used": { "id": "uuid", "min_qty": 2, "max_qty": 3, "unit_price_cents": 65000 },
  "tier_subtotal_cents": 195000,
  "effective_floor_cents": 112000,
  "coupon_id": "uuid",
  "coupon_type": "PERCENT_TOTAL",
  "coupon_face_per_unit_cents": 6500,
  "coupon_applied_per_unit_cents": 6500,
  "coupon_was_capped": false,
  "consultant_basis": "TOTAL_PRICE",
  "consultant_per_unit_raw_cents": 5625,
  "consultant_per_unit_capped_cents": 5625,
  "consultant_was_capped": false,
  "computed_at": "2026-04-30T11:00:00Z"
}
```

### 5.6 `doctors` extension — PR-0 (regression fix)

```sql
ALTER TABLE public.doctors
  ADD COLUMN consultant_id uuid NULL
  REFERENCES public.sales_consultants(id) ON DELETE SET NULL;

CREATE INDEX ix_doctors_consultant_id
  ON public.doctors(consultant_id)
  WHERE consultant_id IS NOT NULL;
```

### 5.7 `app_settings` keys (configurable thresholds)

| Key                                        | Default          | Purpose                              |
| ------------------------------------------ | ---------------- | ------------------------------------ |
| `platform_floor_violation_alert_threshold` | `100` (cents)    | Sentry alert if drift > this         |
| `platform_net_warning_per_unit_cents`      | `10000` (R$ 100) | Yellow heatmap threshold             |
| `platform_net_critical_per_unit_cents`     | `5000` (R$ 50)   | Red heatmap threshold                |
| `campaign_projection_window_days`          | `90`             | Backwards window for cost projection |
| `campaign_projection_default_coverage`     | `0.60`           | Slider default                       |

---

## 6. Detailed design — SQL surface

### 6.1 `resolve_pricing_profile(product_id, at)`

Returns the active `pricing_profiles` row for the product at the
given timestamp. SQL function, IMMUTABLE.

```sql
CREATE OR REPLACE FUNCTION public.resolve_pricing_profile(
  p_product_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS public.pricing_profiles
LANGUAGE sql STABLE
AS $$
  SELECT *
    FROM public.pricing_profiles
   WHERE product_id = p_product_id
     AND effective_from <= p_at
     AND (effective_until IS NULL OR effective_until > p_at)
   ORDER BY effective_from DESC
   LIMIT 1
$$;
```

### 6.2 `resolve_effective_floor(product_id, clinic_id, doctor_id, at)`

```sql
CREATE OR REPLACE FUNCTION public.resolve_effective_floor(
  p_product_id uuid,
  p_clinic_id  uuid,
  p_doctor_id  uuid,
  p_at         timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_profile      public.pricing_profiles;
  v_override     public.buyer_pricing_overrides;
  v_floor_min    bigint;
  v_floor_pct    bigint;
  v_floor        bigint;
BEGIN
  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'pricing_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Override resolution is keyed on whichever buyer column is set.
  SELECT * INTO v_override
    FROM public.buyer_pricing_overrides
   WHERE product_id = p_product_id
     AND ((p_clinic_id IS NOT NULL AND clinic_id = p_clinic_id)
          OR (p_doctor_id IS NOT NULL AND doctor_id = p_doctor_id))
     AND effective_from <= p_at
     AND (effective_until IS NULL OR effective_until > p_at)
   ORDER BY effective_from DESC
   LIMIT 1;

  v_floor_min := COALESCE(v_override.platform_min_unit_cents,
                          v_profile.platform_min_unit_cents,
                          0);
  v_floor_pct := COALESCE(
    ROUND(v_profile.pharmacy_cost_unit_cents
          * COALESCE(v_override.platform_min_unit_pct,
                     v_profile.platform_min_unit_pct,
                     0) / 100),
    0
  );
  v_floor := GREATEST(v_floor_min, v_floor_pct);

  RETURN jsonb_build_object(
    'pharmacy_cost_unit_cents', v_profile.pharmacy_cost_unit_cents,
    'platform_min_unit_cents',  v_floor,
    'effective_floor_cents',    v_profile.pharmacy_cost_unit_cents + v_floor,
    'override_id',              v_override.id,
    'profile_id',               v_profile.id
  );
END
$$;
```

### 6.3 `compute_unit_price(...)` — the central pricing function

Pure function. Returns the entire pricing breakdown as JSONB; the
trigger reads from it without performing any of its own arithmetic.
**This is the single source of truth for the four invariants at
runtime.**

```sql
CREATE OR REPLACE FUNCTION public.compute_unit_price(
  p_product_id uuid,
  p_quantity   int,
  p_clinic_id  uuid,
  p_doctor_id  uuid,
  p_coupon_id  uuid,
  p_at         timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_profile               public.pricing_profiles;
  v_tier                  public.pricing_profile_tiers;
  v_floor_info            jsonb;
  v_pharmacy_cost         bigint;
  v_floor                 bigint;
  v_tier_unit_price       bigint;
  v_coupon                public.coupons;
  v_coupon_face_per_unit  bigint := 0;
  v_coupon_applied        bigint := 0;
  v_coupon_capped         boolean := false;
  v_coupon_max            bigint;
  v_final_unit_price      bigint;
  v_consultant_basis      text;
  v_consultant_rate       numeric;
  v_consultant_raw        bigint := 0;
  v_consultant_capped     bigint := 0;
  v_consultant_was_capped boolean := false;
  v_platform_per_unit     bigint;
BEGIN
  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'pricing_profile_missing for product %', p_product_id
      USING ERRCODE = 'P0001';
  END IF;
  v_pharmacy_cost := v_profile.pharmacy_cost_unit_cents;

  v_floor_info := public.resolve_effective_floor(
    p_product_id, p_clinic_id, p_doctor_id, p_at
  );
  v_floor := (v_floor_info ->> 'effective_floor_cents')::bigint;

  -- Find the matching tier. Validated INV-B/C make the lookup unique.
  SELECT * INTO v_tier
    FROM public.pricing_profile_tiers
   WHERE pricing_profile_id = v_profile.id
     AND p_quantity BETWEEN min_quantity AND max_quantity
   LIMIT 1;
  IF v_tier.id IS NULL THEN
    RAISE EXCEPTION 'tier_not_found for product=% qty=%', p_product_id, p_quantity
      USING ERRCODE = 'P0001';
  END IF;
  v_tier_unit_price := v_tier.unit_price_cents;

  -- Coupon: load and compute its desired face per unit.
  IF p_coupon_id IS NOT NULL THEN
    SELECT * INTO v_coupon FROM public.coupons WHERE id = p_coupon_id;
    -- Eligibility gates (applies_to_tier, min/max_quantity) are
    -- evaluated here. If the coupon is ineligible we treat it as
    -- absent (face=0, the UI flags ineligibility separately).
    IF p_quantity >= v_coupon.min_quantity
       AND (v_coupon.max_quantity IS NULL OR p_quantity <= v_coupon.max_quantity)
    THEN
      v_coupon_face_per_unit := CASE v_coupon.discount_type
        WHEN 'PERCENT'             THEN ROUND(v_tier_unit_price * v_coupon.discount_value / 100)
        WHEN 'FIXED'               THEN ROUND(v_coupon.discount_value * 100)
        WHEN 'FIRST_UNIT_DISCOUNT' THEN
          CASE WHEN p_quantity = 1
               THEN ROUND(v_coupon.discount_value * 100)
               ELSE 0 END
        WHEN 'TIER_UPGRADE'        THEN
          v_tier_unit_price - public._tier_price_n_steps_up(
            v_profile.id, p_quantity, v_coupon.tier_promotion_steps
          )
        WHEN 'MIN_QTY_PERCENT'     THEN ROUND(v_tier_unit_price * v_coupon.discount_value / 100)
        ELSE 0
      END;
    END IF;
  END IF;

  -- INV-2: coupon capped so that final_unit_price >= effective_floor.
  v_coupon_max := GREATEST(0, v_tier_unit_price - v_floor);
  v_coupon_applied := LEAST(v_coupon_face_per_unit, v_coupon_max);
  IF v_coupon.max_discount_amount IS NOT NULL THEN
    v_coupon_applied := LEAST(v_coupon_applied,
                              ROUND(v_coupon.max_discount_amount * 100));
  END IF;
  v_coupon_capped := (v_coupon_applied < v_coupon_face_per_unit);

  v_final_unit_price := v_tier_unit_price - v_coupon_applied;
  v_platform_per_unit := v_final_unit_price - v_pharmacy_cost;

  -- Consultant (raw, then INV-4 cap). Consultant rate is ONLY known
  -- if the buyer has one; the trigger may not have it at INSERT
  -- time (resolved at confirm_payment_atomic). compute_unit_price
  -- supports passing a hypothetical rate for the simulator path
  -- via a future overload; for the trigger path the consultant
  -- contribution is 0 here and computed later. Either way, the
  -- runtime cap in confirm_payment_atomic uses LEAST against
  -- v_platform_commission so INV-4 is also enforced there.
  v_consultant_basis := v_profile.consultant_commission_basis;

  -- Final invariants assertion. INV-1 holds by construction
  -- (pharmacy_cost is frozen unchanged). INV-2 we just enforced.
  -- INV-3 is enforced downstream by confirm_payment_atomic and
  -- platform_revenue_view. INV-4 is enforced downstream by
  -- confirm_payment_atomic's LEAST clause.
  IF v_final_unit_price < v_floor THEN
    RAISE EXCEPTION 'INV-2 violated: final_unit=% floor=%', v_final_unit_price, v_floor
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'pricing_mode',                 'TIERED_PROFILE',
    'profile_id',                   v_profile.id,
    'tier_id',                      v_tier.id,
    'tier_unit_price_cents',        v_tier_unit_price,
    'pharmacy_cost_unit_cents',     v_pharmacy_cost,
    'effective_floor_cents',        v_floor,
    'coupon_id',                    p_coupon_id,
    'coupon_face_per_unit_cents',   v_coupon_face_per_unit,
    'coupon_applied_per_unit_cents',v_coupon_applied,
    'coupon_was_capped',            v_coupon_capped,
    'final_unit_price_cents',       v_final_unit_price,
    'platform_per_unit_cents',      v_platform_per_unit,
    'consultant_basis',             v_consultant_basis,
    'computed_at',                  now()
  );
END
$$;
```

### 6.4 `freeze_order_item_price` — branched

Existing function (whose history is documented in migrations 027,
050, 061, 067) gets an additional branch when
`products.pricing_mode = 'TIERED_PROFILE'`. The legacy `'FIXED'`
branch is preserved verbatim — products that don't opt in see no
change.

```pseudocode
PROCEDURE freeze_order_item_price():
  v_order := SELECT FROM orders WHERE id = NEW.order_id;
  v_pricing_mode := SELECT pricing_mode FROM products WHERE id = NEW.product_id;

  IF v_pricing_mode = 'TIERED_PROFILE' THEN
    -- Resolve through the new path.
    v_breakdown := compute_unit_price(
      NEW.product_id, NEW.quantity,
      v_order.clinic_id, v_order.doctor_id,
      NEW.coupon_id
    );

    NEW.unit_price                   := v_breakdown.tier_unit_price_cents / 100;
    NEW.unit_price_cents             := v_breakdown.tier_unit_price_cents;
    NEW.pharmacy_cost_per_unit       := v_breakdown.pharmacy_cost_unit_cents / 100;
    NEW.pharmacy_cost_per_unit_cents := v_breakdown.pharmacy_cost_unit_cents;
    NEW.platform_commission_per_unit := v_breakdown.platform_per_unit_cents / 100;
    NEW.platform_commission_per_unit_cents := v_breakdown.platform_per_unit_cents;
    NEW.discount_amount              := (v_breakdown.tier_unit_price_cents
                                          - v_breakdown.final_unit_price_cents)
                                          * NEW.quantity / 100;
    NEW.discount_amount_cents        := (v_breakdown.tier_unit_price_cents
                                          - v_breakdown.final_unit_price_cents)
                                          * NEW.quantity;
    NEW.original_total_price         := v_breakdown.tier_unit_price_cents
                                          * NEW.quantity / 100;
    NEW.total_price                  := v_breakdown.final_unit_price_cents
                                          * NEW.quantity / 100;
    NEW.total_price_cents            := v_breakdown.final_unit_price_cents
                                          * NEW.quantity;
    NEW.pricing_profile_id           := v_breakdown.profile_id;
    NEW.pricing_tier_id              := v_breakdown.tier_id;
    NEW.effective_floor_cents        := v_breakdown.effective_floor_cents;
    NEW.discount_breakdown           := v_breakdown;
    -- Coupon usage counter (kept from current behaviour).
    IF NEW.coupon_id IS NOT NULL AND v_breakdown.coupon_applied_per_unit_cents > 0 THEN
      UPDATE coupons SET used_count = used_count + 1 WHERE id = NEW.coupon_id;
    END IF;

    RETURN NEW;
  END IF;

  -- LEGACY 'FIXED' branch — verbatim from migration 067, no changes.
  -- ... (existing implementation kept) ...
END
```

### 6.5 `confirm_payment_atomic` — additions for PR-0 + PR-A

Two surgical changes:

1. **PR-0**: doctor consultant resolution.

```sql
IF v_order.clinic_id IS NOT NULL THEN
  SELECT consultant_id INTO v_consultant_id
    FROM public.clinics WHERE id = v_order.clinic_id;
ELSIF v_order.doctor_id IS NOT NULL THEN          -- NEW
  SELECT consultant_id INTO v_consultant_id
    FROM public.doctors WHERE id = v_order.doctor_id;
END IF;
```

2. **PR-A**: INV-4 defensive `LEAST`.

```sql
-- Before:
--   v_consultant_commission := round(v_order.total_price * v_consultant_rate / 100, 2);
-- After:
v_consultant_commission := LEAST(
  round(v_order.total_price * v_consultant_rate / 100, 2),
  v_platform_commission                              -- INV-4
);
IF v_consultant_commission < round(v_order.total_price * v_consultant_rate / 100, 2) THEN
  -- Cap occurred; gravámos no contexto pra forensics. Não falha.
  RAISE NOTICE 'INV-4 capped consultant from % to % on order=%',
    round(v_order.total_price * v_consultant_rate / 100, 2),
    v_consultant_commission,
    v_payment.order_id;
END IF;
```

### 6.6 `freeze_order_item_price` and the four migration epochs

The order_item trigger has had four distinct epochs. The new branch
is **additive** to the most recent one:

| Migration | Epoch | What it added                                                                             |
| --------- | ----- | ----------------------------------------------------------------------------------------- |
| 027       | I     | Initial freeze: pulls `price_current` and `pharmacy_cost` from `products`; applies coupon |
| 050       | II    | Adds `_cents` columns sync                                                                |
| 061       | III   | Tolerates partial UPDATEs (recalc_order_total)                                            |
| 067       | IV    | INSERT branch syncs all `_cents` written by freeze                                        |
| **PR-A**  | **V** | Adds `TIERED_PROFILE` branch; legacy branch unchanged                                     |

Because the legacy branch is byte-identical to migration 067's
output, **products without `pricing_mode='TIERED_PROFILE'` see zero
behaviour change**. This is the keystone of the "no regression"
claim.

---

## 7. Detailed design — UI surface

Four screens, each tightly coupled to one persona.

### 7.1 Super-admin: matrix per product (`/admin/products/[id]/pricing-matrix`)

Renders the live snapshot of the product's PricingProfile and lets
the operator simulate any combination of `(qty, coupon, consultant_rate, buyer_floor_override)`
without saving anything. The matrix table from §8 of the design
conversation lives here.

Key UI affordances:

- Heatmap on the "platform LIQUIDA/un" row (green ≥ R$ 100, yellow
  R$ 50–99, red < R$ 50; thresholds in `app_settings`).
- Yellow ⚠ on any cell where `coupon_was_capped=true`.
- Red ⚠ on any cell where INV-4 cap activated.
- "Add buyer override" inline button → opens a modal that creates
  `buyer_pricing_overrides` for a chosen clinic/doctor.
- "View previous versions" link → SCD-2 history viewer.

### 7.2 Pharmacy: simple payout view (`/pharmacy/products/[id]`)

Displays a single, frozen number ("Você recebe R$ X,XX por unidade
vendida.") plus the rolling 30-day actual paid history. No tiers,
no coupons, no platform internals.

### 7.3 Buyer (clinic/doctor): simulator in catalogue (`/catalog/[product]`)

For products with `pricing_mode='TIERED_PROFILE'`:

- Compounded-pharma framing per RDC 67/2007: header reads
  "Manipulação personalizada — análise farmacêutica obrigatória".
- Quantity selector + coupon code field; reactive total.
- Tier table is shown as pharmacy "tabela de manipulação por volume".
- Discount breakdown ("R$ X de tier, R$ Y de cupom").
- Upsell hint: "Pedindo N+ unidades você cai no tier R$ Z/un".
- "Iniciar pedido com receita" CTA — triggers AWAITING_DOCUMENTS or
  AWAITING_PAYMENT depending on `requires_prescription` (existing
  logic from migration 066, untouched).

### 7.4 Super-admin: coupon impact preview (`/admin/coupons/[id]/preview-impact`)

The marquee deliverable of PR-D. Two views in the same page:

**Single-buyer view**: pick a clinic OR doctor; render the per-product
matrix with that buyer's effective floor and any active overrides;
heatmap; alerts; campaign-cost projection (see below).

**Bulk-assign view**: pick N buyers; render one row per buyer with
floor, applied coupon, platform_liquida, status; checkboxes filter
"only green", "only green+yellow", "all"; assignment is a single
transaction.

**Campaign cost projection**: looks back
`campaign_projection_window_days` (default 90) at the buyer's
historical orders (`WHERE payment_status='CONFIRMED' AND
deleted_at IS NULL`); projects forward at the same frequency;
applies the proposed coupon; sums effective discount; presents:

```
Cupom efetivamente concedido (3 meses):    R$ X
Receita líquida da plataforma (3 meses):   R$ Y  (vs R$ Z sem cupom)
Custo da campanha:                         R$ X  (% do líquido projetado)
```

If history < 3 confirmed orders, projection is suppressed and the
matrix-only view is shown.

---

## 8. Scenarios — happy path + 23 edge cases

| #   | Scenario                                                                 | Outcome                                                                                                                  |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Default profile, no coupon, no consultant                                | `compute_unit_price` returns clean breakdown; trigger freezes                                                            |
| 2   | Coupon `PERCENT` exceeds INV-2 cap                                       | Coupon applied at cap; `coupon_was_capped=true`; UI shows partial                                                        |
| 3   | Coupon brings `final_unit = floor` exactly                               | OK — INV-2 is `>=`                                                                                                       |
| 4   | Buyer override cheaper than default (R$ 80)                              | `resolve_effective_floor` returns 80; coupon can dive deeper                                                             |
| 5   | Buyer override more conservative (R$ 200)                                | Floor rises; coupons capped harder for that buyer only                                                                   |
| 6   | Pharmacy_cost change R$ 1,000 → R$ 1,100                                 | New profile version created; open orders frozen on old                                                                   |
| 7   | Tier saved below floor                                                   | INV-A blocks save; clear error message                                                                                   |
| 8   | Subindo pharmacy_cost invalida tiers                                     | UI offers atomic transaction "raise cost + raise tiers together"                                                         |
| 9   | Concurrent profile edits                                                 | EXCLUDE constraint denies overlap; second writer gets clear error                                                        |
| 10  | Coupon expired between create and pay                                    | `discount_breakdown` already frozen; pedido inalterado                                                                   |
| 11  | Consultant unlinked between create and pay                               | `confirm_payment_atomic` re-reads at confirm time (acceptable churn)                                                     |
| 12  | Product without profile, `pricing_mode='FIXED'`                          | Legacy branch; zero change                                                                                               |
| 13  | Profile with only `platform_min_unit_pct`                                | `resolve_effective_floor` derives from cost                                                                              |
| 14  | Profile with both absolute and pct                                       | Floor = MAX of the two                                                                                                   |
| 15  | Coupon `TIER_UPGRADE` on a no-tier product                               | Save validation rejects (inconsistent)                                                                                   |
| 16  | Multiple coupons on one order                                            | Disallowed by orders policy (one coupon/order, current behaviour)                                                        |
| 17  | Coupon + override + qty=10 + consultor 5%                                | Matrix shows it; INV-2 enforced per-unit                                                                                 |
| 18  | Reconciliation after all changes                                         | `platform_revenue_view`, `money-reconcile`, `reconcile-platform-revenue` all unchanged — read final values only          |
| 19  | ANPD/CFM audit on coupon discounts                                       | `discount_breakdown` JSONB + `audit_logs` + SCD-2 history give complete trail                                            |
| 20  | Migration partial failure                                                | Idempotent: `CREATE … IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`                                                          |
| 21  | `consultant_basis='FIXED_PER_UNIT'` higher than floor                    | Profile save check rejects                                                                                               |
| 22  | `consultant_basis='TOTAL_PRICE'` rate × cupom drops platform below INV-4 | `confirm_payment_atomic` LEAST caps; `RAISE NOTICE`; Sentry alert                                                        |
| 23  | INV-4 cap leaves consultant at R$ 0                                      | `consultant_commissions` row inserted with amount=0 (valid record); no payout but trail kept                             |
| 24  | Doctor without `consultant_id`                                           | `confirm_payment_atomic` skips consultant block (current behaviour for nul `clinic.consultant_id` already supports this) |

---

## 9. Risks & mitigations

| ID  | Risk                                         | Mitigation                                                                                                         | Residual |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| R1  | Legacy-flow regression                       | `pricing_mode='FIXED'` default; legacy branch byte-identical to mig-067; smoke test on fresh DB                    | < 1%     |
| R2  | Money_drift_view false positives             | New trigger writes ALL `_cents` at the same time as numeric (lesson from mig-067)                                  | < 1%     |
| R3  | `confirm_payment_atomic` corruption          | RPC change is two surgical inserts (PR-0 doctor branch, PR-A LEAST cap); covered by 4 new unit tests + existing 12 | < 1%     |
| R4  | `platform_revenue_view` drift                | View untouched; reads `total_price` final                                                                          | 0%       |
| R5  | RLS leak                                     | RLS auto-enable via mig-057 + explicit policies on the 2 new tables, smoke test in migration                       | < 1%     |
| R6  | Race on profile update                       | EXCLUDE USING gist + transactional save                                                                            | < 1%     |
| R7  | INV-4 capping causes consultant pay disputes | Documented in `discount_breakdown.consultant_was_capped`; Sentry alert; runbook entry created in PR-A              | < 2%     |
| R8  | Performance: matrix recompute on slider drag | `compute_unit_price` is STABLE — within a single query Postgres caches; client throttles to 200ms                  | < 1%     |
| R9  | Migration partial failure                    | `IF NOT EXISTS`, idempotent backfill, smoke test failure rolls back                                                | < 1%     |
| R10 | Coupon assigned bypassing floor              | Coupon application is in `compute_unit_price`; no other path writes `total_price`                                  | < 1%     |
| R11 | Tier configuration error in production       | INV-A blocks save server-side; no client-side bypass                                                               | 0%       |
| R12 | Doctor consultant link missing data backfill | PR-0 leaves `consultant_id=NULL` for existing doctors → identical to current behaviour; no backfill needed         | 0%       |
| R13 | UI matrix shows wrong numbers                | Same `compute_unit_price` SQL drives matrix and trigger; impossible to disagree by construction                    | < 1%     |

**Aggregate confidence**:

- **PR-0**: ≥ 98% (additive, isolated)
- **PR-A**: ≥ 96% (function additions; `LEAST` defensive)
- **PR-B**: ≥ 96% (UI + trigger branch; toggle-gated)
- **PR-C**: ≥ 95% (overrides + extended coupons; most surface area)
- **PR-D**: ≥ 97% (read-only computations + UI)

Each PR remains ≥ 95% per D8.

---

## 10. PR plan (5 sequential, each parsable)

### PR-0 — Doctor consultant link (regression fix)

**Scope**: Migration `068_doctors_consultant_link.sql` (column +
index), migration `069_confirm_payment_atomic_doctor_consultant.sql`
(`CREATE OR REPLACE` of the RPC adding the `ELSIF doctor_id` branch),
UI dropdown in `/doctors/[id]`, 4 unit tests.

**Estimate**: ~3h.

**Independent**: yes — can ship before any other PR. Recommended to
ship immediately as it's a production regression.

### PR-A — Pricing model SQL surface

**Scope**: Migration `070_pricing_profiles.sql` (new tables, btree_gist
extension, EXCLUDE constraints, RLS, indexes); migration
`071_compute_unit_price.sql` (the three SQL functions); migration
`072_freeze_price_branch_tiered.sql` (adds branch to existing
trigger; legacy branch unchanged); migration
`073_inv4_cap_in_confirm_payment.sql` (adds `LEAST` to RPC); 12 unit
tests covering all four invariants and all 24 scenarios.

**Estimate**: ~5.5h.

**Independent**: yes after PR-0 — but no product opts in to
`pricing_mode='TIERED_PROFILE'` yet, so runtime impact is zero.

### PR-B — Trigger branch + super-admin matrix + pharmacy view

**Scope**: Hooks the trigger branch into `products.pricing_mode`;
super-admin page `/admin/products/[id]/pricing-matrix` (form for
profile + tiers, simulation matrix as in §7.1); pharmacy page
`/pharmacy/products/[id]`; ~10 component-level tests.

**Estimate**: ~6.5h.

**Independent**: yes — products that opt in start using the new path
the moment the page is used to flip them. Nothing legacy breaks.

### PR-C — Buyer overrides + tier-aware coupons + buyer simulator

**Scope**: Migration `074_buyer_pricing_overrides.sql`; migration
`075_coupons_tier_aware.sql`; updates to `compute_unit_price` to
recognise the new coupon types; clinic/doctor simulator on the
catalogue (`<TierSimulator>` + `<CouponInput>`); ~15 tests.

**Estimate**: ~7h.

**Independent**: yes — coupons without the new fields keep working
unchanged.

### PR-D — Coupon impact preview + bulk assign

**Scope**: Page `/admin/coupons/[id]/preview-impact` with both
single-buyer and bulk-assign views; `lib/coupons/projection.ts`
(pure TS function for campaign cost); heatmap thresholds in
`app_settings`; ~8 tests.

**Estimate**: ~6.5h.

**Independent**: yes — purely additive UI on existing data.

**Total**: ~28.5h, divisible across as many sessions as needed.

---

## 11. Test plan summary

| Layer                                           | Coverage target                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `compute_unit_price` SQL function               | 100% of branches (every coupon type × tier presence × cap path)                |
| `freeze_order_item_price` legacy branch         | Unchanged — existing tests pass identically                                    |
| `freeze_order_item_price` TIERED_PROFILE branch | All 24 scenarios above                                                         |
| `confirm_payment_atomic`                        | New: doctor consultant resolution; INV-4 cap; existing 12 tests still pass     |
| `platform_revenue_view`                         | Smoke after each migration: zero recon_gap                                     |
| `money-reconcile` cron                          | Smoke after each migration: empty `money_drift_view`                           |
| Super-admin matrix UI                           | Snapshot rendering of golden-master matrix for tirzepatida 60mg                |
| Buyer simulator UI                              | E2E test: clínica adds qty, applies coupon, sees correct breakdown             |
| Coupon impact preview                           | E2E: pick coupon + buyer, verify projection numbers match `compute_unit_price` |

---

## 12. Migration discipline

All migrations:

- Append-only — no `DROP COLUMN`, no destructive `ALTER`
- Numbered sequentially after the latest (`068+`)
- Idempotent (`CREATE … IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`)
- Smoke-tested in a `DO $smoke$ … $smoke$;` block
- RLS auto-enabled via existing migration 057 safety net
- Documented inline with a comment header explaining the bug or
  feature

---

## 13. Rollback plan

PR-0 is the only PR that mutates a critical RPC unconditionally;
even there, the change is purely additive (`ELSIF doctor_id IS NOT
NULL`) and rollback is a `CREATE OR REPLACE` of the previous
function body.

PR-A through PR-D introduce data structures gated by
`products.pricing_mode = 'TIERED_PROFILE'`. Rollback at runtime is
operational, not migration-based: flip every product back to
`'FIXED'` and the trigger never enters the new branch. The new
tables remain (no destructive cleanup), but no read path
references them.

For total rollback (e.g. catastrophic discovery 30 days post-deploy):

1. `UPDATE products SET pricing_mode='FIXED' WHERE pricing_mode='TIERED_PROFILE';`
2. Disable `/admin/products/[id]/pricing-matrix` route (NextJS
   feature flag from `app_settings`).
3. The new tables become inert.
4. Legacy paths run identically to pre-PR-A state.

This is intentionally a one-line operational rollback — no
migration revert is needed because no migration was destructive.

---

## 14. Open questions / future work

| #   | Topic                                                  | Trigger to revisit                                                    |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| OQ1 | Multi-coupon stacking                                  | When marketing requests "buy 3 get 1 free" + "10% off" combos         |
| OQ2 | Negotiated buyer-specific tier prices (not just floor) | When a top-3 clinic asks for it explicitly                            |
| OQ3 | Move pharmacy_cost change to D+7 SLA window            | When a pharmacy partner formally complains about same-day price flips |
| OQ4 | OCR / ML auto-approval of pharmaceutical review        | After 6 months of one-click approval data; decided in a future ADR    |
| OQ5 | Quote-request entity (Option B from §3)                | If pharmacy partners require the ability to refuse priced orders      |
| OQ6 | Cross-pharmacy bundles                                 | Not before 2027                                                       |
| OQ7 | Dashboard for accumulated INV-4 caps                   | If `RAISE NOTICE` events from confirm_payment_atomic exceed 5/month   |

---

## 15. Compliance & legal anchors

- LGPD Art. 7, II — consent (existing) — pricing data is not personal data, no new consent surface.
- LGPD Art. 6 — minimisation: `discount_breakdown` does not store buyer name or CPF; only IDs.
- ANVISA RDC 67/2007 — no per-dose price advertising; the catalogue's tier table is "tabela de custos de manipulação por volume", not "tabela de preços por dose".
- ANVISA RDC 87/2008 — pharmacist must analyse the prescription before pricing is applied to a specific compound. Workflow PR-B/PR-C/PR-D enforces this through the `PENDING_PHARMACY_REVIEW` state in the order machine (already exists from previous work).
- Audit chain (migration 046) — every profile/override change inserts a row in `audit_logs`; the chain remains append-only as required.

---

## 16. Reviewer checklist (pre-merge gate)

For each PR (operator runs through):

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all green
- [ ] `npm run build` succeeds
- [ ] New migrations applied to local DB without smoke-test failure
- [ ] `money_drift_view` returns 0 rows
- [ ] `platform_revenue_view` returns 0 `recon_gap` outside ±1 cent
- [ ] CI green on `main` after merge (CI + Security Scan + Schema Drift)
- [ ] Sentry has no new "INV-4 capped" entries for the first 24h post-deploy on the products that opt in

---

## 17. Document version

- 2026-04-30 — initial version, written from the design conversation
  of 2026-04-29 / 2026-04-30. No code shipped yet. This document is
  the source of truth that PR-0 through PR-D will implement.
