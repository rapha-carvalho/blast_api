const Stripe = require("stripe");

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" })
  : null;

module.exports = {
  stripe,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PRICE_ID_MENTORSHIP: process.env.STRIPE_PRICE_ID_MENTORSHIP,
  PRICE_ID_MONTHLY: process.env.STRIPE_PRICE_ID_MONTHLY,
  PRICE_ID_YEARLY: process.env.STRIPE_PRICE_ID_YEARLY,
  PRICE_ID_ONETIME: process.env.STRIPE_PRICE_ID_ONETIME,
};
