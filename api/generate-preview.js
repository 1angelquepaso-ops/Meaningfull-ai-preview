// /api/generate-preview.js
// Meaningfull™ AI Preview — MVP (Controlled Luxury + Flexibility)
// Engine: Replicate (Flux)
// SAFE for Shopify + Vercel

const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ================= CONFIG =================
const MAX_GENERATIONS = 2;
const generationCount = new Map();

// ================= CORS =================
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ================= HELPERS =================
function normalizeStr(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}
function toLower(s) {
  return normalizeStr(s).toLowerCase();
}

function inferRecipientGroup(recipient = "", notes = "") {
  const text = `${recipient} ${notes}`.toLowerCase();

  const female = [
    "wife","girlfriend","mom","mother","sister","daughter","girl",
    "woman","women","her","she"
  ];
  const male = [
    "husband","boyfriend","dad","father","brother","son","boy",
    "man","men","him","he"
  ];

  const isFemale = female.some(k => text.includes(k));
  const isMale = male.some(k => text.includes(k));

  if (isFemale && !isMale) return "female";
  if (isMale && !isFemale) return "male";
  return "neutral";
}

// ================= PROMPT BUILDER =================
function buildPrompt({ inputs, tier }) {
  const isSignature = String(tier || "").toLowerCase().includes("signature");
  const recipientGroup = inferRecipientGroup(inputs.recipient || "", inputs.notes || "");
  const notesText = toLower(inputs.notes || "");

  const MUST_INCLUDE = [];
  const NEGATIVE = [];

  // ---------- COLOR / STYLE BY RECIPIENT ----------
  const PALETTES = {
    female: "soft ivory, warm beige, blush-neutral accents, subtle gold or brass details",
    male: "charcoal, black, deep navy, warm gray, brushed metal accents",
    neutral: "ivory, stone, warm gray, charcoal accents, minimal restrained tones"
  };

  MUST_INCLUDE.push(`apply a ${recipientGroup} premium palette: ${PALETTES[recipientGroup]}`);

  // ================= HARD DENY LIST (MINIMAL) =================
  NEGATIVE.push(
    // Packing / filler
    "no pillows",
    "no cushions",
    "no sachets",
    "no drawstring bags",

    // Tiny low-value disposables
    "no sheet masks",
    "no mini or travel-size skincare",
    "no hand cream tubes",

    // Cheap candle formats only
    "no tea lights",
    "no votive candles",

    // Paper clutter
    "no loose cards",
    "no posters",
    "no unbound prints",

    // Visual junk
    "no excessive small items",
    "no decorative padding"
  );

  // ================= SIGNATURE HERO =================
  if (isSignature) {
    MUST_INCLUDE.push(
      "include ONE dominant modern sculptural lifestyle object as the hero (ceramic, stone, resin, metal, or leather)",
      "hero object must feel trend-forward, expensive, and gallery-worthy",
      "all other items must be secondary and smaller"
    );

    NEGATIVE.push(
      "no consumable item as hero",
      "no candle, skincare, fragrance, journal, or self-care item as the primary object",
      "no spa-kit look",
      "no cluttered assortment of small consumables"
    );
  }

  // ================= CONDITIONAL ALLOWANCES =================

  // Gift shop trinkets
  MUST_INCLUDE.push(
    "gift shop trinkets are allowed if premium-looking; limit to ONE small accent item; no plastic novelty"
  );
  NEGATIVE.push("no multiple cheap trinkets");

  // Candle sets
  MUST_INCLUDE.push(
    "candle sets are allowed; maximum two candles; substantial vessels; premium materials; not tea lights or votives"
  );

  // Bath bombs / lip balm
  const selfCareRequested = ["bath","bath bomb","lip balm","self care","self-care"].some(k =>
    notesText.includes(k)
  );

  if (!isSignature || recipientGroup === "female" || selfCareRequested) {
    MUST_INCLUDE.push(
      "bath bombs or lip balm allowed only as a single small secondary accent; must not dominate"
    );
  } else {
    NEGATIVE.push("no bath bombs", "no lip balm");
  }

  // Throws / blankets
  MUST_INCLUDE.push(
    "throws or blankets allowed only if folded, premium-looking, neutral-toned, and not bed-like"
  );
  NEGATIVE.push("no oversized blanket dominating the composition");

  // Soft cosmetic bags — OPEN ONLY
  MUST_INCLUDE.push(
    "soft cosmetic bags allowed only if OPEN with contents visible"
  );
  NEGATIVE.push(
    "no closed cosmetic bags",
    "no zipped cosmetic pouches"
  );

  // ================= FINAL PROMPT =================
  return `
High-end photorealistic studio product photography of a premium AI-curated gift box with contents clearly visible.

Tier: ${tier}
Recipient: ${inputs.recipient}
Occasion: ${inputs.occasion}
Vibe: ${inputs.vibe || "Refined"}

STYLE:
- modern premium lifestyle aesthetic
- editorial product photography
- intentional composition with negative space
- realistic materials and textures
- unbranded items only

MUST INCLUDE:
- ${MUST_INCLUDE.join("; ")}

NEGATIVE CONSTRAINTS:
- ${NEGATIVE.join(", ")}

Notes (user intent):
${inputs.notes || "None"}
`.trim();
}

// ================= HANDLER =================
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

    const imageUrl = Array.isArray(output) ? output[0] : output;
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
