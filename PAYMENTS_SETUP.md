# Eatsbythia — Card Payments Setup (Stripe)

This adds real card payment at checkout using Stripe Checkout. Customers now
pay before an order lands in Fathia's kitchen — unpaid/abandoned checkouts
never show up there.

## How it works

```
Customer fills in order → your Edge Function creates the order
(reusing create_order(), same server-side pricing as before) → creates a
Stripe Checkout Session → customer is redirected to Stripe to pay
                                    ↓
                    Stripe redirects back to your site (UX only)
                                    ↓
        Stripe also calls your webhook function server-to-server
        (the ONLY thing that actually marks the order "paid")
                                    ↓
              Kitchen dashboard only ever shows paid orders
```

The webhook, not the redirect, is what marks an order paid — a customer
closing the tab early can't fake a paid order, and a slow redirect can't
cause the kitchen to miss a real one.

## 1. Create the Stripe account

1. Go to https://dashboard.stripe.com/register and create an account under
   Fathia's business details (business name, address, bank account for
   payouts). Stripe will ask to verify identity/business details before
   payouts start — do this early, it can take a day or two.
2. Stay in **test mode** (toggle top-right of the Stripe dashboard) until
   everything below is confirmed working.

## 2. Get your Stripe secret key

Dashboard → **Developers → API keys**. Copy the **Secret key** (starts
`sk_test_...` in test mode). You will NOT need the publishable key for this
integration — Stripe Checkout's hosted page doesn't require it client-side.

Never put the secret key in `index.html`, `.env.local`, or anything that
ships to a browser. It only ever goes into Supabase's server-side secrets
(next step).

## 3. Run the new SQL migration

In Supabase → SQL Editor, run `supabase_schema_v2_payments.sql` (in this
folder). It adds payment-status columns to `orders` and — importantly —
revokes the public anon key's ability to call `create_order` directly, so
"card-only" can't be bypassed from a browser console. Read the comments in
that file before running it.

**Before running it**, your checked-in `supabase_schema.sql` doesn't
actually match your live database anymore — `create_order` and the "find my
order" lookup policy aren't in that file, so they were added directly in
the dashboard at some point. Worth exporting your real current schema
(Database → Backups, or `supabase db dump`) and replacing the stale file in
this repo, so future changes are based on what's actually live, not what's
checked in.

## 4. Install the Supabase CLI (if you haven't)

```
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is the subdomain in your Supabase URL, e.g. for
`https://abcxyz.supabase.co` it's `abcxyz`.

## 5. Set the function secrets

```
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_key_here
supabase secrets set SITE_URL=https://your-live-site-url.com
```

(`SITE_URL` with no trailing slash — it's used to build the redirect links
Stripe sends customers back to.) `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are already available automatically inside Edge
Functions — you don't set those yourself.

## 6. Deploy the two functions

```
supabase functions deploy create-checkout-session --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` is required for both — customers placing orders and
Stripe's webhook calls are never logged-in Supabase users, so there's no
Supabase JWT to verify.

## 7. Point a Stripe webhook at your deployed function

1. Copy the `stripe-webhook` function's URL from the Supabase CLI output —
   it looks like `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`.
2. Stripe Dashboard → **Developers → Webhooks → Add endpoint**, paste that
   URL.
3. Select these events: `checkout.session.completed`,
   `checkout.session.expired`, `charge.refunded`.
4. After creating it, click into the endpoint and copy its **Signing
   secret** (starts `whsec_...`).
5. Set it:
   ```
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
   ```

## 8. Test end-to-end (test mode)

1. Run `npm run dev`, open the site, place an order.
2. You should be redirected to a Stripe-hosted payment page.
3. Use Stripe's test card: `4242 4242 4242 4242`, any future expiry, any
   CVC, any postcode.
4. After paying, you land back on the site with a "Payment received"
   toast and your order's tracking view.
5. Open the kitchen dashboard — the order should now appear there. Orders
   you abandon at the Stripe page (click back, or just leave it) should
   **not** appear in the kitchen.
6. Check Stripe Dashboard → Payments to see the test payment, and check
   the `orders` table — `payment_status` should read `paid`.

## 9. Go live

Once everything above works in test mode:

1. Complete Stripe's business verification if you haven't already
   (required before it'll process real charges).
2. Switch the Stripe dashboard to **live mode**, grab the live secret key
   (`sk_live_...`) and repeat steps 5–7 with live values (`supabase secrets
   set STRIPE_SECRET_KEY=sk_live_...`, and create a *second* webhook
   endpoint in live mode with its own signing secret).
3. Re-test with a real card for a small amount before telling customers
   it's live.

## Known follow-ups (not done in this pass)

- **`addDish()` is defined twice** in `index.html` — an old localStorage
  stub silently wins over the real Supabase-backed version, so adding a
  dish from the kitchen UI doesn't currently persist. Worth fixing next.
- **The "find my order" lookup** reads orders by order number under a
  public Supabase policy that isn't in the checked-in schema file. Order
  numbers are only 3 random digits (`ETB-100`–`ETB-999`) — that's a small
  enough space to enumerate, which would expose every customer's name,
  WhatsApp number, and address to anyone who tried. Worth tightening
  (e.g. a narrower RPC that returns less, and/or longer order numbers)
  once we have the real current policy to work from.
