import { v2 as cloudinary } from "cloudinary";

export default async function handler(req, res) {  // ✅ CORS (required for Shopify storefront -> Vercel API)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { occasion, recipient, vibe, notes = "" } = req.body || {};
    if (!occasion || !recipient || !vibe) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const prompt = [
      "Create a premium, photorealistic product-style preview of an open curated gift box.",
      "",
      `Context: Occasion: ${occasion}; Recipient: ${recipient}; Vibe: ${vibe}.`,
      notes ? `Notes: ${notes}` : "",
      "",
      "Visual requirements:",
      "- Top-down or 3/4 angle, studio lighting, soft shadows",
      "- Neutral background (light stone / off-white)",
      "- Elegant nested packaging: tissue paper, ribbon, neat layering",
      "- A few tasteful, non-branded lifestyle items (no logos, no readable labels)",
      "- No people, no hands, no faces",
      "- No text, no typography, no watermarks, no brand marks",
      "",
      "Goal: a believable curation-direction preview, not exact SKUs."
    ].filter(Boolean).join("\n");

    const openaiRes = await fetch("https://api.openai.com/v1/images", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        output_format: "png"
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text();
      return res.status(500).json({ error: "OpenAI image error", detail: txt });
    }

    const json = await openaiRes.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "No base64 image returned" });

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    const uploadResult = await cloudinary.uploader.upload(
      `data:image/png;base64,${b64}`,
      { folder: "meaningfull-previews" }
    );

    return res.status(200).json({ imageUrl: uploadResult.secure_url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
