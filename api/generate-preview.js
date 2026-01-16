const OpenAI = require("openai");

/**
 * Meaningfull™ AI Preview Generator (MVP)
 * CommonJS version for Vercel Node compatibility
 */

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
  ]
    .filter(Boolean)
    .join(" | ");

  return [
    "Create a premium, photorealistic product preview image for an AI-curated gift box brand called Meaningfull™.",
    "The image should look like an elegant, modern gift box package preview on a clean studio background.",
    "Include: a tasteful gift box, tissue paper, subtle ribbon, and 3–6 small curated items partially visible (no brand logos).",
    "Style: minimal, premium, high-end ecommerce product photography, soft shadows, sharp focus.",
    "IMPORTANT: No text, no buttons, no UI, no watermarks, no logos.",
    variant
      ? `Tier/Variant context: ${variant}.`
      : "Tier/Variant context: not specified.",
    social
      ? `Optional style context provided by customer (do not browse or scrape): ${social}. Use only as inspiration for vibe/colors.`
      : "No social style context provided.",
    "Output: one square image, centered composition.",
  ].join("\n");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const body = req.body || {};
    const variant = clean(body.variant, 200);
    const instagram = clean(body.instagram, 200);
    const tiktok = clean(body.tiktok, 200);

    const prompt = buildPrompt({ variant, instagram, tiktok });

    const model = process.env.IMAGE_MODEL || "gpt-image-1";

    const result = await client.images.generate({
      model,
      prompt,
      size: "1024x1024",
    });

    const first = result?.data?.[0];

    const imageUrl =
      first?.url ||
      (first?.b64_json
        ? `data:image/png;base64,${first.b64_json}`
        : null);

    if (!imageUrl) {
      return res.status(500).json({
        error: "No image returned from the image model.",
        debug: { model },
      });
    }

    return res.status(200).json({ imageUrl });
  } catch (err) {
    return res.status(500).json({
      error: "Preview generation failed.",
      message: err?.message || "Unknown error",
    });
  }
};
