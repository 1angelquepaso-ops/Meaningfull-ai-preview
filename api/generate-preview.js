// api/generate-preview.js
// Meaningfull™ AI Preview — Vercel Serverless Function (CommonJS)
// - Replicate (Flux) image generation
// - CORS + OPTIONS preflight support (required for Shopify)
// - Max 2 generations per sessionId (MVP in-memory)
// - Occasion + Recipient motifs drive item content (Baby shower => baby items, etc.)

const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MAX_GENERATIONS = 2;
const generationCount = new Map();

// ✅ Use your exact EasyFlow option text (case/spacing matters)
const OCCASION_MOTIFS = {
  "Birthday": [
    "birthday-themed items visible",
    "small celebration accents (confetti, candles, ribbon)",
    "a greeting card or gift tag vibe"
  ],
  "Christmas": [
    "holiday-themed items visible",
    "winter/evergreen accents, cozy seasonal feel",
    "gift wrap details, festive but premium"
  ],
  "Halloween": [
    "halloween-themed items visible",
    "pumpkin/orange/black accents, playful spooky (not horror)",
    "seasonal treats or cozy autumn vibe"
  ],
  "New Years": [
    "new year celebration feel",
    "sparkle accents, classy festive styling",
    "midnight celebration vibe (not nightclub)"
  ],
  "Baby shower": [
    "baby-themed items visible",
    "onesie or baby clothing",
    "baby blanket or soft plush",
    "pacifier or baby bottle",
    "gentle pastel styling"
  ],
  "Easter": [
    "easter-themed items visible",
    "spring/pastel accents, soft cheerful styling",
    "chocolate eggs or bunny motif"
  ],
  "Valentines Day": [
    "romantic-themed items visible",
    "rose or heart accents, warm intimate styling",
    "love note card vibe"
  ],
  "Just Because": [
    "thoughtful everyday gift feel",
    "cozy, uplifting, personal touches",
    "subtle, not overly seasonal"
  ]
};

const RECIPIENT_MOTIFS = {
  "Boyfriend": [
    "masculine-leaning but not stereotypical",
    "personal and romantic touches appropriate for boyfriend"
  ],
  "Girlfriend": [
    "feminine-leaning but not stereotypical",
    "personal and romantic touches appropriate for girlfriend"
  ],
  "Husband": [
    "mature masculine-leaning, refined",
    "practical + sentimental mix appropriate for husband"
  ],
  "Wife": [
    "mature feminine-leaning, refined",
    "sentimental + elegant touches appropriate for wife"
  ],
  "Someone I'm dating": [
    "early-relationship appropriate (sweet, not too intense)",
    "polished, safe, thoughtful vibe"
  ],
  "Friend": [
    "friendly, fun, not romantic",
    "universally likeable items"
  ],
  "Sibling": [
    "playful, casual, inside-joke energy",
    "fun but still thoughtful"
  ],
  "Mom": [
    "warm, caring, elevated comfort vibe",
    "thoughtful, appreciative touches"
  ],
  "Dad": [
    "warm, practical, classic vibe",
    "thoughtful, appreciative touches"
  ],
  "My Pet": [
    "pet-themed items visible",
    "treats/toys/accessories appropriate for a pet gift",
    "cute but premium presentation"
  ]
};

// Optional: vibe-to-style tightening (you can expand this later)
const VIBE_STYLE = {
  "Minimalist": [
    "minimal, uncluttered composition",
    "neutral or soft muted palette",
    "fewer, cleaner items",
    "modern premium packaging"
  ],
  "Luxury": [
    "high-end premium look",
    "richer textures",
    "elevated presentation"
  ],
  "Playful": [
    "brighter accents",
    "fun, lively styling"
  ]
};

function setCors(res) {
  // MVP: allow all origins. For launch-hardening you can change to https://meaningfull.co
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(res);

  // ✅ Preflight support for Shopify
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN in Vercel env vars" });
    }

    const body = req.body || {};
    const inputs = body.inputs;
    const sessionId = body.sessionId;

    if (!inputs || !sessionId) {
      return res.status(400).json({ error: "Missing inputs or sessionId" });
    }

    const used = generationCount.get(sessionId) || 0;
    if (used >= MAX_GENERATIONS) {
      return res.status(429).json({ error: "Generation limit reached", used });
    }

    const occasionRulesArr = OCCASION_MOTIFS[inputs.occasion] || ["items should clearly match the occasion"];
    const recipientRulesArr = RECIPIENT_MOTIFS[inputs.recipient] || ["items should clearly match the recipient type"];
    const vibeRulesArr = VIBE_STYLE[inputs.vibe] || ["styling should match the selected vibe"];

    // "Must include" reinforcement for Baby shower + My Pet (helps prevent misses)
    const MUST_INCLUDE = [];
    if (inputs.occasion === "Baby shower") {
      MUST_INCLUDE.push("include at least TWO of these baby items clearly visible: onesie, baby bottle, pacifier, baby blanket, plush toy");
    }
    if (inputs.recipient === "My Pet") {
      MUST_INCLUDE.push("include pet items clearly visible: pet treats, toy, collar or accessory");
    }

    // Safety / quality constraints (prevents weird outputs)
    const NEGATIVE = [
      "no text",
      "no logos",
      "no watermarks",
      "no explicit content",
      "no alcohol",
      "no weapons",
      "no lingerie",
      "no cigarettes or drugs",
      "no gore or horror"
    ].join(", ");

    const prompt = `
Photorealistic product photography of a premium nested gift box with items visible.

Occasion: ${inputs.occasion}
Recipient: ${inputs.recipient}
Vibe: ${inputs.vibe || "Not specified"}

HARD CONSTRAINTS:
- ${occasionRulesArr.join("; ")}
- ${recipientRulesArr.join("; ")}
- ${vibeRulesArr.join("; ")}
- show items that obviously communicate the occasion (not subtle)
- tasteful, premium, ready-to-gift presentation
- realistic lighting, realistic textures, studio/product photo look
- ${MUST_INCLUDE.length ? MUST_INCLUDE.join("; ") : "items should be clearly relevant and appropriate"}

NEGATIVE CONSTRAINTS:
- ${NEGATIVE}

Optional context (use as subtle influence only):
Notes: ${inputs.notes || "None"}
Social: ${inputs.social || "None"}
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

    return res.status(200).json({
      imageUrl,
      used: used + 1
    });

  } catch (err) {
    console.error("generate-preview crashed:", err);
    return res.status(500).json({ error: "Generation failed" });
  }
};
