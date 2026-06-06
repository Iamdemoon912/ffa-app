// Netlify Function: verify a Stripe Checkout Session is real and paid.
// Endpoint: /.netlify/functions/verify?session_id=cs_...
// Returns: { paid: true } or { paid: false, reason: "..." }
//
// Requires env var STRIPE_SECRET_KEY (set in Netlify dashboard, NOT in code).

const Stripe = require("stripe");

exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ paid: false, reason: "server_not_configured" }),
      };
    }

    const sessionId = (event.queryStringParameters || {}).session_id;
    if (!sessionId || !/^cs_/.test(sessionId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ paid: false, reason: "missing_or_invalid_session_id" }),
      };
    }

    const stripe = Stripe(key);

    // Retrieve the session straight from Stripe — the source of truth.
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // A session is "paid" when payment_status is "paid".
    // (For £0 / fully-discounted it can be "no_payment_required" — treat as paid too.)
    const ok =
      session &&
      (session.payment_status === "paid" ||
        session.payment_status === "no_payment_required") &&
      session.status === "complete";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        paid: !!ok,
        reason: ok ? "ok" : "not_paid",
      }),
    };
  } catch (err) {
    // Unknown/expired/forged session IDs throw here — treat as not paid.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ paid: false, reason: "lookup_failed" }),
    };
  }
};
