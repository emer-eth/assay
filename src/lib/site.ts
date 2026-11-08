/** The public address of this deployment (Railway sets RAILWAY_PUBLIC_DOMAIN; the fallback is the current host). */
export const SITE = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "https://web-production-a10bc.up.railway.app";
