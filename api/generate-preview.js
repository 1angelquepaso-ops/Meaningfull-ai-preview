// /api/generate-preview.js
// Meaningfull™ AI Preview — MVP + Luxury Signature Enforcement
// Engine: Replicate (default) with OpenAI optional switch
// SAFE for Shopify + MVP

const Replicate = require("replicate");

// ================= CONFIG =================
const MAX_GENERATIONS = 2;
const generationCount = new Map();
const PREVIEW_ENGINE = (process.env.PREVIEW_ENGINE || "replicate").toLowerCase();

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ================= CORS =================
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ================= NOTES PARSING =================
function extractAge(notes = "") {
  const m = String(notes).match(/(\d{1,2})\s*(?:yo|y\/o|years?\s*old)/i);
  if (!m) return null;
  const age = Number(m[1]);
  return Number.isFinite(age) ? age : null;
}

function extractColors(notes = "") {
  const n = String(notes).toLowerCase();
  const COLORS = [
    "black","white","gray","grey","ivory","bone",
    "silver","gold","brass",
    "navy","blue","beige","cream",
    "charcoal","stone"
  ];
  return COLORS.filter(c => new RegExp(`\\b${c}\\b`).test(n));
}

function buildNotesRules(notes = "") {
  const raw = String(notes || "");
  const n = raw.toLowerCase();
  const hard = [];
  const avoid = [];

  const age = extractAge(raw);
  if (age !== null) {
    if (age <= 12) hard.push("child-safe items only; no adult themes");
    else hard.push("adult-appropriate items");
  }

  if (n.includes("no alcohol")) avoid.push("no alcohol");
  if (n.includes("no chocolate")) avoid.push("no chocolate");
  if (n.includes("no fragrance")) avoid.push("no fragrance");

  const colors = extractColors(raw);
  if (colors.length) {
    hard.push(`color palette must include: ${colors.join(", ")}`);
  }

  return { raw, hard, avoid, age };
}

// ================= OPTION MAPS =================
const OCCASION_MOTIFS = {
  "Valentines Day": ["romantic tone", "warm emotional styling"],
  "Birthday": ["celebratory but refined"],
  "Just Because": ["timeless, non-seasonal feel"],
};

const RECIPIENT_MOTIFS = {
  "Partner": ["romantic but elevated"],
  "Friend": ["neutral, refined"],
  "Parent": ["warm, premium, timeless"],
};

const VIBE_STYLE = {
  "Minimalist": ["clean composition", "neutral tones"],
  "Luxury": ["high-end editorial feel"],
  "Surprise me": ["balanced premium styling"],
};

// ================= BRAND LOCK =================
const BRAND_RULES = [
  "high-end luxury lifestyle aesthetic",
  "editorial product photography",
  "soft diffused studio lighting",
  "realistic premium materials",
  "no logos or branding on items",
];

const BRAND_NEGATIVE = [
  "no text",
  "no logos",
  "no labels",
  "no watermarks",
  "no UI elements",
];

// ================= PROMPT BUILDER =================
function buildPrompt({ inputs, tier }) {
  const notes = buildNotesRules(inputs.notes || "");
  const isSignature = String(tier).toLowerCase().includes("signature");

  const occasion = OCCASION_MOTIFS[inputs.occasion] || [];
  const recipient = RECIPIENT_MOTIFS[inputs.recipient] || [];
  const vibe = VIBE_STYLE[inputs.vibe] || [];

  const MUST_INCLUDE = [];
  const NEGATIVE = [...BRAND_NEGATIVE, ...notes.avoid];

  // ---------- TIER ENFORCEMENT ----------
  let tierLine;

  if (isSignature) {
    tierLine = `
SIGNATURE TIER — HIGH-END LUXURY EDITORIAL:
- ultra-premium minimalist luxury aesthetic
- fewer items (maximum 5), each substantial and material-rich
- include ONE dominant luxury hero object (ceramic, glass, stone, metal, or leather)
- restrained neutral palette (ivory, bone, charcoal, warm gray, navy, black)
- generous negative space and calm composition
- packaging appears heavy, rigid, museum-quality
- deep visible layering across boxes
- editorial styling (luxury magazine product shoot)
`;

    MUST_INCLUDE.push(
      "items must appear physically larger, heavier, and more valuable than Starter tier items"
    );

    NEGATIVE.push(
      "no plush toys",
      "no novelty figurines",
      "no party favors",
      "no cartoonish or cute objects",
      "no cluttered compositions",
      "no seasonal props dominating the scene"
    );
  } else {
    tierLine = `
STARTER TIER — CURATED:
- thoughtful, warm, approachable presentation
- more items allowed, lighter visual weight
- still premium, but friendly and accessible
`;
  }

  return `
High-end photorealistic studio product photography of a premium AI-curated gift box.

${tierLine}

Occasion: ${inputs.occasion}
Recipient: ${inputs.recipient}
Vibe: ${inputs.vibe}

STYLE RULES:
- ${BRAND_RULES.join("; ")}

OCCASION CUES:
- ${occasion.join("; ")}

RECIPIENT CUES:
- ${recipient.join("; ")}

VIBE CUES:
- ${vibe.join("; ")}

HARD CONSTRAINTS:
- gift box is OPEN with contents visible
- premium rigid box construction
- intentional spacing and composition
- ${notes.hard.join("; ")}

MUST INCLUDE:
- ${MUST_INCLUDE.join("; ")}

NEGATIVE CONSTRAINTS:
- ${NEGATIVE.join(", ")}

Notes (user intent):
${notes.raw || "None"}
`.trim();
}

// ================= HANDLER =================
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { inputs, sessionId, tier = "Curated" } = req.body || {};
    if (!inputs || !sessionId) {
      return res.status(400).json({ error: "Missing inputs or sessionId" });
    }

    const used = generationCount.get(sessionId) || 0;
    if (used >= MAX_GENERATIONS) {
      return res.status(429).json({ error: "Generation limit reached" });
    }

    const prompt = buildPrompt({ inputs, tier });

    let imageUrl;

    if (PREVIEW_ENGINE === "replicate") {
      const output = await replicate.run(
        process.env.REPLICATE_MODEL || "black-forest-labs/flux-dev",
        {
          input: {
            prompt,
            aspect_ratio: "1:1",
            output_format: "webp",
            quality: 90,
          },
        }
      );
      imageUrl = Array.isArray(output) ? output[0] : output;
    } else {
      return res.status(500).json({ error: "OpenAI engine disabled in MVP" });
    }

    generationCount.set(sessionId, used + 1);

    res.status(200).json({
      ok: true,
      tier,
      used: used + 1,
      imageUrl,
    });
  } catch (err) {
    console.error("Preview generation failed:", err);
    res.status(500).json({ error: "Generation failed" });
  }
};
