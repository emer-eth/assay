/**
 * The public address of this deployment. SITE_URL wins when set (use it once a custom domain is
 * attached); otherwise Railway's RAILWAY_PUBLIC_DOMAIN, then the known Railway address.
 */
export const SITE = process.env.SITE_URL?.replace(/\/$/, "")
  ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "https://web-production-a10bc.up.railway.app");
