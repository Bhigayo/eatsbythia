-- Eatsbythia production database
-- Run this in Supabase SQL Editor after creating a project.

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null default 'Manchester',
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  image_url text,
  available boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  whatsapp text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, whatsapp)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  order_number text not null,
  status text not null default 'new'
    check (status in ('new','confirmed','preparing','ready','completed','cancelled')),
  order_type text not null check (order_type in ('delivery','collection')),
  address text,
  requested_time text,
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_number)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name_snapshot text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0)
);

create index if not exists orders_business_created_idx
  on public.orders (business_id, created_at desc);

create index if not exists orders_business_status_idx
  on public.orders (business_id, status);

create index if not exists menu_business_sort_idx
  on public.menu_items (business_id, sort_order);

alter table public.businesses enable row level security;
alter table public.menu_items enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- For the first real pilot, keep the public customer menu readable.
-- Production authentication policies should be tightened around Fathia's user id.
create policy "public can read active menu"
on public.menu_items for select
to anon, authenticated
using (active = true);

-- Public customers need to be able to create orders.
-- In production, use a server-side RPC/edge function to validate totals
-- and prevent clients from forging prices.
create policy "public can create customers"
on public.customers for insert
to anon, authenticated
with check (true);

create policy "public can create orders"
on public.orders for insert
to anon, authenticated
with check (true);

create policy "public can create order items"
on public.order_items for insert
to anon, authenticated
with check (true);

-- IMPORTANT:
-- Do not add public SELECT/UPDATE policies for orders.
-- Fathia's authenticated role should receive those through a secured policy
-- tied to her business membership.
