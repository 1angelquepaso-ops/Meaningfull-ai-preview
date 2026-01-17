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
    "small celebration accents (balloons, confetti, candles, ribbon)",
    "a greeting card or gift tag vibe"
  ],
  "Christmas": [
    "holiday-themed items visible",
    "winter/evergreen accents, cozy seasonal feel",
    "gift wrap details, festive but premium"
  ],
  "Halloween": [
    "halloween-themed items visible",
    "pumpkin/orange/black/purple/green accents, playful spooky horror)",
    "classic candy simple halloween costume seasonal treats or cozy autumn vibe classic horror movie"
  ],
  "New Years": [
    "new year celebration feel",
    "sparkle accents, classy festive styling",
    "midnight celebration vibe gala nightclub"
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
  "Partner": [
    "romantic or emotionally warm items depending on vibe",
    "thoughtful, intimate but tasteful presentation"
  ],
  "Parent": [
    "warm, appreciative, comforting items",
    "sentimental but practical, elevated everyday gifts"
  ],
  "Son": [
    "child-appropriate, fun, age-aware items",
    "no adult or romantic themes"
  ],
  "Daughter": [
    "child-appropriate, warm, playful or sentimental items",
    "no adult or romantic themes"
  ],
  "Sibling": [
    "casual, friendly, non-romantic items",
    "balanced and age-appropriate"
  ],
  "Friend": [
    "neutral, thoughtful, non-romantic items",
    "universally appealing presentation"
  ],
  "Relative": [
    "safe, family-friendly, neutral items",
    "avoid romance or intimacy"
  ],
  "My Pet": [
    "pet-related items only",
    "toys, treats, accessories, playful tone"
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
- the gift box must be OPEN with the lid removed or pushed aside
- items inside the box must be clearly visible at first glance
- ${occasionRulesArr.join("; ")}
- ${recipientRulesArr.join("; ")}
- ${tierRulesArr.join("; ")}
- tasteful, premium, ready-to-gift presentation
- realistic lighting, realistic textures, studio/product photo look

NEGATIVE CONSTRAINTS:
- no empty boxes
- no closed lids
- no sealed packaging
- no boxes without visible contents
- no text, no logos, no watermarks
- no explicit content
`.trim();
