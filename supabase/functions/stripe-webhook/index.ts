// Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt
//
// This is the ONLY place that marks an order as paid. The success_url
// redirect the customer's browser follows is just UX — a customer could
// close the tab before it loads, or the redirect could be interrupted, so
// it must never be treated as proof of payment. Stripe calls this endpoint
// server-to-server once the payment has actually gone through, and we
// verify the request really came from Stripe using the signing secret
// before trusting anything in it.
//
// Secrets this function needs (set with `supabase secrets set`):
//   STRIPE_SECRET_KEY      same one used by create-checkout-session
//   STRIPE_WEBHOOK_SECRET  whsec_... — from the Stripe Dashboard webhook
//                          you create pointing at this function's URL

import Stripe from "npm:stripe@17?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  if (!signature) {
    return new Response("Missing signature.", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  try {
    switch (event.type) {      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        if (orderId) {
          const { error } = await supabaseAdmin
            .from("orders")
            .update({
              payment_status: "paid",
              stripe_payment_intent_id:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id ?? null,
              paid_at: new Date().toISOString(),
            })
            .eq("id", orderId)
            .eq("payment_status", "pending"); // don't re-mark a refunded order paid
          if (error) console.error("Failed to mark order paid:", error);
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        if (orderId) {
          await supabaseAdmin
            .from("orders")
            .update({ payment_status: "failed", status: "cancelled" })
            .eq("id", orderId)
            .eq("payment_status", "pending");
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;
        if (paymentIntentId) {
          await supabaseAdmin
            .from("orders")
            .update({ payment_status: "refunded" })
            .eq("stripe_payment_intent_id", paymentIntentId);
        }
        break;
      }

      default:
        // Ignore other event types — ask Stripe to include more later if needed.
        break;
    }
  } catch (err) {
    console.error("Error handling webhook event:", err);
    // Return 500 so Stripe retries — a DB hiccup here is worth retrying;
    // silently swallowing it would leave a paid order stuck as "pending"
    // forever with nothing to prompt a retry.
    return new Response("Internal error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
