-- Eatsbythia V3: privacy, kitchen access and ordering controls
-- Run this in the Supabase SQL Editor AFTER supabase_schema_v2_payments.sql.
--
-- BEFORE RUNNING: replace REPLACE_WITH_FATHIA_LOGIN_EMAIL below with the email
-- Fathia uses to sign in to the kitchen. The whole script stops and changes
-- nothing if that account can't be found.
--
-- What this does:
--   1. Adds the columns for closing orders, allergens and private tracking.
--   2. Records who is allowed into the kitchen.
--   3. Replaces EVERY existing access rule on the order and menu tables, so
--      no older public rule can keep exposing customer details.
--   4. Stops create_order being called from a browser. Revoking it only from
--      anon and authenticated isn't enough, as Postgres also grants PUBLIC.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'payment_status'
  ) then
    raise exception 'Run supabase_schema_v2_payments.sql first.';
  end if;
end $$;

-- 1. New columns
alter table public.businesses
  add column if not exists accepting_orders boolean not null default true,
  add column if not exists order_cutoff time not null default '18:00';

alter table public.menu_items
  add column if not exists allergens text not null default '';

alter table public.orders
  add column if not exists tracking_token uuid not null default gen_random_uuid();

-- 2. Kitchen access
create table if not exists public.kitchen_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (business_id, user_id)
);
alter table public.kitchen_members enable row level security;

create or replace function public.is_kitchen_member(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.kitchen_members
    where business_id = target_business and user_id = auth.uid()
  );
$$;
revoke all on function public.is_kitchen_member(uuid) from public, anon;
grant execute on function public.is_kitchen_member(uuid) to authenticated;

do $$
declare
  fathia_email text := 'abdulmalikayomide40@gmail.com';
  fathia_id uuid;
begin
  select id into fathia_id from auth.users where lower(email) = lower(fathia_email);
  if fathia_id is null then
    raise exception 'No login found for %. Nothing was changed.', fathia_email;
  end if;
  insert into public.kitchen_members (business_id, user_id)
  values ('944d4bd8-6533-4df2-82d8-b7107e4110cf', fathia_id)
  on conflict do nothing;
end $$;

-- 3. Replace every access rule, whatever it was called
do $$
declare
  rule record;
begin
  for rule in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('businesses','menu_items','customers','orders','order_items')
  loop
    execute format('drop policy %I on public.%I', rule.policyname, rule.tablename);
  end loop;
end $$;

alter table public.businesses enable row level security;
alter table public.menu_items enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Public: only the menu and whether orders are open
create policy "public can read businesses" on public.businesses
  for select to anon, authenticated using (true);
create policy "public can read active menu" on public.menu_items
  for select to anon, authenticated using (active = true);

-- Kitchen: everything for its own business
create policy "kitchen updates business" on public.businesses
  for update to authenticated
  using (public.is_kitchen_member(id))
  with check (public.is_kitchen_member(id));

create policy "kitchen reads menu" on public.menu_items
  for select to authenticated using (public.is_kitchen_member(business_id));
create policy "kitchen adds menu" on public.menu_items
  for insert to authenticated with check (public.is_kitchen_member(business_id));
create policy "kitchen updates menu" on public.menu_items
  for update to authenticated
  using (public.is_kitchen_member(business_id))
  with check (public.is_kitchen_member(business_id));

create policy "kitchen reads customers" on public.customers
  for select to authenticated using (public.is_kitchen_member(business_id));

create policy "kitchen reads orders" on public.orders
  for select to authenticated using (public.is_kitchen_member(business_id));
create policy "kitchen updates orders" on public.orders
  for update to authenticated
  using (public.is_kitchen_member(business_id))
  with check (public.is_kitchen_member(business_id));

create policy "kitchen reads order items" on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and public.is_kitchen_member(o.business_id)
    )
  );

-- 4. Only the server can create orders
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_order'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end $$;

commit;
