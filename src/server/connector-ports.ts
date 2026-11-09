import { WiseAdapter } from "@/data/bank/wise";
import { StripeAdapter } from "@/data/bank/stripe";

type Env = Record<string, string | undefined>;

/**
 * LIVE connector ports built from the resolved configuration (env first, then the app's vault, D087). getContext()
 * rebuilds them when a value changes, so a key saved in Settings › Integrations works without a redeploy.
 */

/** Wise read access: WISE_API_TOKEN, optional WISE_PROFILE_ID and WISE_SCA_PRIVATE_KEY_BASE64. */
export function wiseFromEnv(env: Env) {
  const token = env.WISE_API_TOKEN;
  if (!token) return null;
  const key = env.WISE_SCA_PRIVATE_KEY_BASE64 ? Buffer.from(env.WISE_SCA_PRIVATE_KEY_BASE64, "base64").toString("utf8") : null;
  return new WiseAdapter(env.WISE_API_BASE_URL || "https://api.wise.com", token, key, env.WISE_PROFILE_ID || null);
}

/** Stripe read access: STRIPE_API_KEY (restricted, Read). */
export function stripeFromEnv(env: Env) {
  return env.STRIPE_API_KEY ? new StripeAdapter(env.STRIPE_API_BASE_URL || "https://api.stripe.com", env.STRIPE_API_KEY) : null;
}
