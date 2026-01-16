import OpenAI from "openai";
import { v2 as cloudinary } from "cloudinary";

// Cloudinary config (set these in Vercel Environment Variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req, res) {
  // ✅ CORS (Shopify storefront -> Vercel API)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { occasion, recipient, vibe, notes = "" } = body || {};

    if (!occasion || !recipient || !vibe) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // OpenAI client
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Prompt
    const prompt = [
      "Create a premium, photorealistic product-style preview of an open curated gift box.",
      "The box contains 6-10 cohesive items that match the recipient and vibe (no brand logos, no readable text).",
      "Neutral studio lighting, clean background, high-end ecommerce aesthetic.",
      `Context: Occasion: ${occasion}; Recipient: ${recipient}; Vibe: ${vibe}.`,
      notes ? `Extra notes: ${notes}.` : "",
    ].join(" ");

    // ✅ IMPORTANT: NO response_format (this is what was breaking)
    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const b64 = img?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: "No image returned from OpenAI" });
    }

    // Upload to Cloudinary
    const upload = await cloudinary.uploader.upload(
      `data:image/png;base64,${b64}`,
      {
        folder: "meaningfull/previews",
      }
    );

    return res.status(200).json({ imageUrl: upload.secure_url });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
