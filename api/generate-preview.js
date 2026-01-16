import OpenAI from "openai";

/**
 * Meaningfull™ AI Preview Generator (MVP)
 * - Accepts: productId, variant, instagram, tiktok
 * - Returns: { imageUrl } where imageUrl is either a URL or a data URL (base64)
 * - Notes:
 *   - We do NOT scrape social profiles. We treat handles/links as optional style context.
 *   - Rate-limit / "2 max" is enforced on Shopify (client-side) for MVP simplicity.
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // MVP: open CORS
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function clean(s, maxLen = 300) {
  if (!s) return "";
  return String(s).trim().slice(0, maxLen);
}

function buildPrompt({ variant, instagram, tiktok }) {
  const social = [
    instagram ? `Instagram: ${instagram}` : null,
    tiktok ? `TikTok: ${tiktok}` : null,
  ].filter(Boolean).join(" | ");

  return [
    "Create a premium, photorealistic product preview ima
