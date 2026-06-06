// Netlify Function: Stripe webhook -> emails the buyer their access link.
// Listens for checkout.session.completed.
// Env vars required:
//   STRIPE_SECRET_KEY       (already set)
//   STRIPE_WEBHOOK_SECRET   (from the Stripe webhook endpoint you create: whsec_...)
//   RESEND_API_KEY          (from resend.com)
//   FROM_EMAIL              (e.g. "Football Not Soccer <access@football-not-soccer.com>")
//   APP_BASE_URL            (e.g. "https://app.football-not-soccer.com")

const Stripe = require("stripe");

exports.handler = async function (event) {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Netlify gives the body base64-encoded; Stripe needs the RAW bytes to verify.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : event.body;

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return { statusCode: 400, body: "Webhook signature verification failed: " + err.message };
  }

  // Only act on a completed checkout.
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const email =
      (session.customer_details && session.customer_details.email) ||
      session.customer_email;
    const sessionId = session.id;
    const base = process.env.APP_BASE_URL || "https://app.football-not-soccer.com";
    const accessUrl = base + "/?session_id=" + sessionId;

    if (email) {
      try {
        await sendEmail(email, accessUrl);
      } catch (e) {
        // Don't fail the webhook on email error; log and still 200 so Stripe doesn't retry-storm.
        console.error("Email send failed:", e && e.message ? e.message : e);
      }
    }
  }

  // Always 200 quickly so Stripe marks it delivered.
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendEmail(to, accessUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL || "Football Not Soccer <onboarding@resend.dev>";
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6">' +
    '<h2 style="font-family:Arial,sans-serif">Your WC2026 Fantasy Almanac access</h2>' +
    '<p>Thanks for your purchase! Tap the button below to open the app any time \u2014 ' +
    'this link is your permanent access, so keep this email.</p>' +
    '<p><a href="' + accessUrl + '" style="display:inline-block;background:#1d6b3a;color:#fff;' +
    'text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">Open the Almanac \u2192</a></p>' +
    '<p style="font-size:13px;color:#666">If the button doesn\u2019t work, copy this link:<br>' + accessUrl + '</p>' +
    '<p style="font-size:12px;color:#999">Football Not Soccer \u2014 unofficial fan resource.</p>' +
    '</div>';

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: from,
      to: [to],
      subject: "Your WC2026 Fantasy Almanac access link",
      html: html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Resend " + res.status + ": " + t);
  }
}
