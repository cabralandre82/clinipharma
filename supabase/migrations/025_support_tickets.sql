-- =============================================
-- Migration 025: Support Ticket System
-- =============================================

-- Enums
DO $$ BEGIN
  CREATE TYPE ticket_category AS ENUM ('ORDER', 'PAYMENT', 'TECHNICAL', 'GENERAL', 'COMPLAINT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sequence for human-readable ticket codes
CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START 1;

-- Tickets table
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,          -- TKT-2026-00001
  title                text NOT NULL,
  category             ticket_category NOT NULL DEFAULT 'GENERAL',
  priority             ticket_priority NOT NULL DEFAULT 'NORMAL',
  status               ticket_status NOT NULL DEFAULT 'OPEN',
  created_by_user_id   uuid NOT NULL REFERENCES public.profiles(id),
  assigned_to_user_id  uuid REFERENCES public.profiles(id),
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate ticket code on insert
CREATE OR REPLACE FUNCTION generate_ticket_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.code := 'TKT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('support_ticket_seq')::text, 5, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_code ON public.support_tickets;
CREATE TRIGGER trg_ticket_code
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION generate_ticket_code();

-- Messages table (conversation thread)
CREATE TABLE IF NOT EXISTS public.support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES public.profiles(id),
  body        text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,  -- internal note: visible only to admins
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_by ON public.support_tickets(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON public.support_messages(ticket_id);

-- Update updated_at on ticket when a message is added
CREATE OR REPLACE FUNCTION touch_ticket_on_message()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.support_tickets
  SET updated_at = now()
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ticket ON public.support_messages;
CREATE TRIGGER trg_touch_ticket
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION touch_ticket_on_message();

-- =============================================
-- RLS
-- =============================================
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Tickets: creator sees own; admins see all
CREATE POLICY "tickets_select_own" ON public.support_tickets
  FOR SELECT USING (
    created_by_user_id = auth.uid()
    OR public.is_platform_admin()
  );

CREATE POLICY "tickets_insert_authenticated" ON public.support_tickets
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND created_by_user_id = auth.uid());

CREATE POLICY "tickets_update_admin" ON public.support_tickets
  FOR UPDATE USING (public.is_platform_admin());

-- Messages: same ticket visibility; internal notes restricted to admins
CREATE POLICY "messages_select" ON public.support_messages
  FOR SELECT USING (
    (
      EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id = ticket_id
          AND (t.created_by_user_id = auth.uid() OR public.is_platform_admin())
      )
    )
    AND (is_internal = false OR public.is_platform_admin())
  );

CREATE POLICY "messages_insert" ON public.support_messages
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND sender_id = auth.uid()
    AND (
      -- clients can only post to their own tickets
      EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id = ticket_id AND t.created_by_user_id = auth.uid()
      )
      OR public.is_platform_admin()
    )
    -- only admins can post internal notes
    AND (is_internal = false OR public.is_platform_admin())
  );
