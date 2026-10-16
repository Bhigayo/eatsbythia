# Eatsbythia Production V1

This package is the handoff point between the prototype and the real hosted MVP.

## Architecture

Customer browser
→ hosted Eatsbythia frontend
→ Supabase database
→ Fathia Kitchen dashboard

WhatsApp remains the communication layer.

## What is already designed

- Customer menu
- Basket and checkout
- WhatsApp number captured with order
- Order number
- Order status lifecycle
- Fathia kitchen dashboard
- Daily menu management
- Manchester delivery/collection context

## What must happen before live launch

1. Create a Supabase project.
2. Run `supabase_schema.sql`.
3. Create Fathia's authenticated user.
4. Create the Eatsbythia business row and save its UUID.
5. Add the Supabase URL, publishable key and business UUID to environment variables.
6. Replace the prototype's localStorage repository with Supabase calls.
7. Add secured RLS policies for Fathia's business membership.
8. Test customer phone → database → Fathia phone.
9. Connect the production domain.
10. Give Fathia the ordering link.

## Important

The public client must never receive a Supabase service-role key.
Prices should be recalculated server-side before an order is accepted in the production implementation.
