// Deploy with: supabase functions deploy order-status --no-verify-jwt
//
// The only public way to read an order. The browser no longer touches the
// orders table: it must prove it owns the order with either
//   - the private tracking token from the Stripe return link, or
//   - the order number plus the WhatsApp number used on the order.
// It returns what the tracking screen needs and never the phone or address.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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

// 07123..., 447123... and +44 7123... all become 7123...
function normalisePhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").replace(/^(44|0)/, "");
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

  const { business_id, order_number, tracking_token, whatsapp } = body ?? {};
  const orderNumber = String(order_number ?? "").trim().toUpperCase();
  const phone = normalisePhone(whatsapp);

  if (!business_id || !orderNumber || (!tracking_token && !phone)) {
    return json({ error: "Missing order details." }, 400);
  }

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(`
      order_number, status, payment_status, order_type, requested_time,
      total, created_at, tracking_token,
      customers ( name, whatsapp ),
      order_items ( name_snapshot, unit_price, quantity )
    `)
    .eq("business_id", business_id)
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (error) {
    console.error("order-status lookup failed:", error);
    return json({ error: "We couldn't look up that order right now." }, 500);
  }

  const customer = Array.isArray(order?.customers)
    ? order?.customers[0]
    : order?.customers;
  const allowed =
    !!order &&
    ((!!tracking_token && tracking_token === order.tracking_token) ||
      (!!phone && phone === normalisePhone(customer?.whatsapp)));

  // Same answer for "no such order" and "wrong details", so this can't be
  // used to find out which order numbers exist.
  if (!allowed) {
    return json({ error: "We couldn't find an order with those details." }, 404);
  }

  return json({
    order_number: order.order_number,
    status: order.status,
    payment_status: order.payment_status,
    order_type: order.order_type,
    requested_time: order.requested_time,
    total: order.total,
    created_at: order.created_at,
    first_name: String(customer?.name ?? "").trim().split(/\s+/)[0] || "there",
    items: order.order_items ?? [],
    tracking_token: order.tracking_token,
  });
});
