// Deploy with: supabase functions deploy create-checkout-session --no-verify-jwt
//
// Called by the customer's browser (via fetch, using the public anon key
// origin — no auth header required). It:
//   1. Calls the existing create_order() RPC with the service_role key,
//      so it still gets that function's server-side price lookup, but is
//      no longer reachable by anyone calling the RPC directly from a browser.
//   2. Builds a Stripe Checkout Session from the order_items that
//      create_order() itself just wrote (so the prices Stripe charges are
//      the same ones the kitchen will see — never numbers the client sent).
//   3. Returns the Checkout Session URL for the browser to redirect to.
//
// Secrets this function needs (set with `supabase secrets set`):
//   STRIPE_SECRET_KEY   sk_test_... (or sk_live_... once you go live)
//   SITE_URL            e.g. https://eatsbythia.example.com (no trailing slash)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// the Supabase Edge Function runtime — you don't need to set those.

import Stripe from "npm:stripe@17?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const SITE_URL = Deno.env.get("SITE_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const {
    business_id,
    customer_name,
    whatsapp,
    order_type,
    address,
    requested_time,
    items,
  } = body ?? {};

  if (
    !business_id ||
    !customer_name ||
    !whatsapp ||
    !order_type ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return json({ error: "Missing required order details." }, 400);
  }
  if (order_type === "Delivery" && !address) {
    return json({ error: "A delivery address is required." }, 400);
  }

  // 1. Create the order using the same RPC the site already trusted for
  // server-side price validation — just now called with the service_role
  // key instead of directly from the browser.
  const { data: orderResult, error: orderError } = await supabaseAdmin.rpc(
    "create_order",
    {
      p_business_id: business_id,
      p_customer_name: customer_name,
      p_whatsapp: whatsapp,
      p_order_type: order_type,
      p_address: address ?? "",
      p_requested_time: requested_time ?? "",
      p_items: items,
    }
  );

  if (orderError) {
    console.error("create_order failed:", orderError);
    return json(
      { error: "Sorry, we couldn't place that order. Please check the menu and try again." },
      409
    );
  }

  const orderNumber = orderResult?.order_number;
  if (!orderNumber) {
    console.error("create_order returned no order_number:", orderResult);
    return json({ error: "Something went wrong creating your order." }, 500);
  }

  // 2. Re-fetch the order + its (server-priced) items to build Stripe's
  // line items — never trust anything the browser sent for pricing.
  const { data: order, error: fetchError } = await supabaseAdmin
    .from("orders")
    .select("id, total, order_items(name_snapshot, unit_price, quantity)")
    .eq("business_id", business_id)
    .eq("order_number", orderNumber)
    .single();

  if (fetchError || !order) {
    console.error("Could not reload created order:", fetchError);
    return json({ error: "Something went wrong preparing your payment." }, 500);
  }

  const lineItems = (order.order_items ?? []).map((item: any) => ({
    quantity: item.quantity,
    price_data: {
      currency: "gbp",
      unit_amount: Math.round(Number(item.unit_price) * 100),
      product_data: { name: item.name_snapshot },
    },
  }));

  if (lineItems.length === 0) {
    return json({ error: "That order has no items to charge for." }, 400);
  }

  // 3. Create the Stripe Checkout Session.
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      customer_email: undefined, // we only collect WhatsApp, not email
      metadata: {
        order_id: order.id,
        order_number: orderNumber,
        business_id,
      },
      success_url: `${SITE_URL}/?order=${orderNumber}&payment=success`,
      cancel_url: `${SITE_URL}/?order=${orderNumber}&payment=cancelled`,
    });
  } catch (err) {
    console.error("Stripe session creation failed:", err);
    return json({ error: "Payment could not be started. Please try again." }, 502);
  }

  await supabaseAdmin
    .from("orders")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", order.id);

  return json({ url: session.url, orderNumber });
});
