// api/generate-preview.js

import OpenAI from "openai";

export default async function handler(req, res) {
  // ✅ CORS (required for Shopify storefront -> Vercel API)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Vercel sometimes gives body as string; handle both
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { occasion, recipient, vibe, notes = "" } = body || {};
    if (!occasion || !recipient || !vibe) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const prompt = [
      "Create a premium, photorealistic product-style preview of an open curated gift box.",
      "The box is neatly arranged on a clean minimal background, soft studio lighting, elegant composition.",
      `Occasion: ${occasion}. Recipient: ${recipient}. Vibe: ${vibe}.`,
      notes ? `Extra notes: ${notes}.` : "",
      "No text, no logos, no watermarks."
    ].filter(Boolean).join(" ");

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ✅ Return base64 so we don't need Cloudinary yet
    const img = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json"
    });

    const b64 = img?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: "Image generation returned no data" });
    }

    return res.status(200).json({
      ok: true,
      imageDataUrl: `data:image/png;base64,${b64}`
    });
  } catch (err) {
    console.error("generate-preview error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err)
    });
  }
}
