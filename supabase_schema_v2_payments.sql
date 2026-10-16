-- Eatsbythia V2 — Stripe payments
-- Run this in the Supabase SQL Editor AFTER supabase_schema.sql.
-- Safe to re-run (uses if not exists / if exists guards throughout).

-- 1. Payment tracking columns on orders
alter table public.orders
  add column if not exists payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed','refunded')),
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists paid_at timestamptz;

create index if not exists orders_business_payment_status_idx
  on public.orders (business_id, payment_status);

-- 2. Close the "pay by console" bypass.
--
-- Card payment only means something if customers can no longer create an
-- order without paying for it. Right now the create_order() function is
-- callable directly by the public anon key (the same key that ships to
-- every browser) — anyone with dev tools open could call it and land a
-- real order in Fathia's kitchen without ever reaching Stripe.
--
-- From now on, orders are created exclusively by the create-checkout-session
-- Edge Function, which runs with the service_role key server-side. That key
-- is never exposed to the browser, so this revoke fully closes the bypass.
--
-- NOTE: if you get an error here about function name / argument types not
-- matching, open Database → Functions → create_order in the Supabase
-- dashboard, copy its exact signature, and substitute it below — Postgres
-- only lets you omit the argument list when the function name is unique.
revoke execute on function public.create_order from anon, authenticated;
grant execute on function public.create_order to service_role;

-- 3. The old public insert policies are also no longer needed now that
-- order creation only happens server-side with the service_role key,
-- which bypasses RLS entirely. Dropping them removes another path a
-- client could otherwise use to insert a priced order directly.
drop policy if exists "public can create customers" on public.customers;
drop policy if exists "public can create orders" on public.orders;
drop policy if exists "public can create order items" on public.order_items;
