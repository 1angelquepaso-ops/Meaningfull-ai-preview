const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MAX_GENERATIONS = 2;
const generationCount = new Map();

function setCors(res) {
  // MVP: allow all. Later restrict to https://meaningfull.co
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(res);

  // ✅ IMPORTANT: handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const inputs = body.inputs;
    const sessionId = body.sessionId;

    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN in Vercel env vars" });
    }

    if (!inputs || !sessionId) {
      return res.status(400).json({ error: "Missing inputs or sessionId" });
    }

    const used = generationCount.get(sessionId) || 0;
    if (used >= MAX_GENERATIONS) {
      return res.status(429).json({ error: "Generation limit reached", used });
    }

    const prompt = `
Premium nested gift box presentation, realistic product photography.
Occasion: ${inputs.occasion}
Recipient: ${inputs.recipient}
Vibe: ${inputs.vibe}
Notes: ${inputs.notes || "None"}
Social context: ${inputs.social || "None"}

Elegant, thoughtful, ready-to-gift.
Curated items that match the vibe.
Soft lighting, realistic textures.
No text, no logos, no watermarks.
`.trim();

    const output = await replicate.run("black-forest-labs/flux-dev", {
      input: {
        prompt,
        aspect_ratio: "1:1",
        output_format: "webp",
        quality: 80
      }
    });

    const imageUrl = Array.isArray(output) ? output[0] : output;

    generationCount.set(sessionId, used + 1);

    return res.status(200).json({ imageUrl, used: used + 1 });
  } catch (err) {
    console.error("generate-preview crashed:", err);
    return res.status(500).json({ error: "Generation failed" });
  }
};
