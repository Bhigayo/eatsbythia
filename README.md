# Eatsbythia

Online ordering and a live kitchen dashboard for Eatsbythia, a home-based Nigerian food business in Manchester.

Customers order and pay by card. Paid orders appear on Fathia's dashboard straight away, and customers can track their order.

## How it works

- **Website:** a Vite single-page site hosted on GitHub Pages
- **Database and login:** Supabase, with row-level security
- **Payments:** Stripe Checkout, confirmed by a signed webhook
- **Server functions:** `create-checkout-session`, `stripe-webhook` and `order-status`

The browser can only read the public menu and whether orders are open. Customer and order data is available only to signed-in kitchen staff, or through `order-status` to someone who proves the order is theirs.

## Run it locally

1. Copy `.env.example` to `.env.local` and add your Supabase details.
2. Run `npm install`, then `npm run dev`.

## Set up or update the live system

1. Run `supabase_schema.sql` and `supabase_schema_v2_payments.sql` if you haven't already.
2. Add Fathia's login email to `supabase_schema_v3_security.sql`, then run it in the Supabase SQL Editor.
3. In Supabase, go to Authentication and turn off new sign-ups.
4. Follow `PAYMENTS_SETUP.md` to set secrets and deploy all three functions.
5. Push to `main` to deploy the website. Do this after step 2, because the site needs the new columns.
6. Add allergens for every dish in the kitchen dashboard.
7. Fill in the bracketed details in `public/privacy.html`.
8. Test a full order in Stripe test mode, then go live.

Never put the Supabase service-role key or the Stripe secret key in the website code.
