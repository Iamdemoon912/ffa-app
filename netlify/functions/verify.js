const Stripe = require("stripe");

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, headers, body: JSON.stringify({ paid: false, reason: "server_not_configured" }) };
  }

  const sessionId = (event.queryStringParameters || {}).session_id;
  if (!sessionId) {
    return { statusCode: 400, headers, body: JSON.stringify({ paid: false, reason: "missing_or_invalid_session_id" }) };
  }

  const stripe = Stripe(key);

  // Attempt 1: retrieve as Checkout Session, expand the payment_intent
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const pi = session.payment_intent;
    const piPaid = pi && typeof pi === "object" && pi.status === "succeeded";
    const ok = session &&
      (session.payment_status === "paid" || session.payment_status === "no_payment_required" || piPaid) &&
      (session.status === "complete" || piPaid);
    return { statusCode: 200, headers, body: JSON.stringify({
      paid: !!ok, reason: ok ? "ok" : "not_paid",
      detail: { via: "session", payment_status: session.payment_status, status: session.status,
        pi_status: (pi && typeof pi === "object") ? pi.status : (typeof pi === "string" ? "(unexpanded)" : null) }
    }) };
  } catch (errSession) {
    // Attempt 2: try a payment_intent id if present
    try {
      const piMatch = String(sessionId).match(/pi_[A-Za-z0-9]+/);
      if (piMatch) {
        const pi = await stripe.paymentIntents.retrieve(piMatch[0]);
        const ok = pi && pi.status === "succeeded";
        return { statusCode: 200, headers, body: JSON.stringify({
          paid: !!ok, reason: ok ? "ok" : "not_paid", detail: { via: "payment_intent", pi_status: pi ? pi.status : null } }) };
      }
      throw errSession;
    } catch (errPi) {
      return { statusCode: 200, headers, body: JSON.stringify({
        paid: false, reason: "lookup_failed",
        detail: {
          session_error: (errSession && errSession.message) ? errSession.message : String(errSession),
          session_error_type: (errSession && errSession.type) ? errSession.type : null,
          pi_error: (errPi && errPi.message) ? errPi.message : null
        }
      }) };
    }
  }
};
