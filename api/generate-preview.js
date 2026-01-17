import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Hard server-side limit
const MAX_GENERATIONS = 2;

// Simple in-memory session cap (MVP-safe)
const generationCount = new Map();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { inputs, sessionId } = req.body;

    if (!inputs || !sessionId) {
      return res.status(400).json({ error: "Missing inputs or sessionId" });
    }

    const used = generationCount.get(sessionId) || 0;
    if (used >= MAX_GENERATIONS) {
      return res.status(429).json({ error: "Generation limit reached" });
    }

    // Build prompt (gift-focused, not art-chaos)
    const prompt = `
A premium nested gift box presentation.
Occasion: ${inputs.occasion}
Recipient: ${inputs.recipient}
Vibe: ${inputs.vibe}

The box is elegant, thoughtful, and ready-to-gift.
Items feel curated, meaningful, and emotionally appropriate.
Soft lighting, realistic textures, lifestyle product photography.
No text, no logos, no watermarks.
`;

    const output = await replicate.run(
      "black-forest-labs/flux-dev",
      {
        input: {
          prompt,
          aspect_ratio: "1:1",
          output_format: "webp",
          quality: 80,
        },
      }
    );

    const imageUrl = Array.isArray(output) ? output[0] : output;

    generationCount.set(sessionId, used + 1);

    return res.status(200).json({
      imageUrl,
      used: used + 1,
    });

  } catch (err) {
    console.error("AI generation error:", err);
    return res.status(500).json({ error: "Generation failed" });
  }
}

