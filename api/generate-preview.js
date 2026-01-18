// /api/generate-preview.js
// Meaningfull™ AI Preview — MVP (Robust Option-Set Key Mapping)
// Engine: Replicate (Flux)
// SAFE for Shopify + Vercel
//
// ✅ Fix: supports BOTH old + new OptionSet field titles (locked keys)
//   Old labels:
//     - "Who is this gift for?"
//     - "What's their vibe?"
//     - "Occasion"
//     - "Anything Else"
//     - "Social Links"
//   New labels (IP-safe):
//     - "Who’s this gift for?"
//     - "What’s their vibe?"
//     - "What’s the occasion?"
//     - "Anything you’d like us to know?"
//     - "Optional inspiration (links, profiles, or references)"

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

// Normalize smart quotes → straight quotes so label matching won’t break
function normalizeKey(k) {
  return normalizeStr(k)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

/**
 * Pull a value from a "properties" / "inputs" object using multiple possible keys.
 * Supports:
 * - exact keys
 * - tolerant label variants
 */
function pickField(obj, keyCandidates = []) {
  if (!obj || typeof obj !== "object") return "";

  // direct hit (case-insensitive + smart quote normalized)
  const map = new Map();
  for (const [k, v] of Object.entries(obj)) {
    map.set(normalizeKey(k), v);
  }

  for (const cand of keyCandidates) {
    const v = map.get(normalizeKey(cand));
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }

  // fallback: contains match (useful if apps append extra text)
  const keys = Array.from(map.keys());
  for (const cand of keyCandidates) {
    const nc = normalizeKey(cand);
    const hit = keys.find((k) => k.includes(nc));
    if (hit) {
      const v = map.get(hit);
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
    }
  }

  return "";
}

/**
 * Coerces whatever the frontend sends into the canonical inputs your prompt builder expects.
 * Accepts either:
 *  - req.body.inputs = { recipient, vibe, occasion, notes, social }
 *  - OR req.body.inputs/properties = line-item style labels
 */
function coerceInputs(payloadInputs) {
  const inputs = payloadInputs && typeof payloadInputs === "object" ? payloadInputs : {};

  // If the frontend already sends canonical keys, honor them first.
  const canonicalRecipient = inputs.recipient || inputs.to || inputs.for || "";
  const canonicalVibe = inputs.vibe || "";
  const canonicalOccasion = inputs.occasion || "";
  const canonicalNotes = inputs.notes || inputs.anythingElse || "";
  const canonicalSocial = inputs.social || inputs.socialLinks || inputs.links || "";

  // If any canonical is present, keep it — otherwise derive from label-based keys.
  const recipient =
    normalizeStr(canonicalRecipient) ||
    normalizeStr(
      pickField(inputs, [
        "Who's this gift for?",
        "Who’s this gift for?",
        "Who is this gift for?",
        "Gift for",
        "Recipient",
        "To",
      ])
    );

  const vibe =
    normalizeStr(canonicalVibe) ||
    normalizeStr(
      pickField(inputs, [
        "What's their vibe?",
        "What’s their vibe?",
        "Vibe",
        "Their vibe",
      ])
    );

  const occasion =
    normalizeStr(canonicalOccasion) ||
    normalizeStr(
      pickField(inputs, [
        "What's the occasion?",
        "What’s the occasion?",
        "Occasion",
        "Event",
      ])
    );

  const notes =
    normalizeStr(canonicalNotes) ||
    normalizeStr(
      pickField(inputs, [
        "Anything you'd like us to know?",
        "Anything you’d like us to know?",
        "Anything Else",
        "Anything else",
        "Notes",
        "Special notes",
      ])
    );

  const social =
    normalizeStr(canonicalSocial) ||
    normalizeStr(
      pickField(inputs, [
        "Optional inspiration (links, profiles, or references)",
        "Optional inspiration",
        "Social Links",
        "Social links",
        "Links",
        "Inspiration",
      ])
    );

  return { recipient, vibe, occasion, notes, social };
}

function inferRecipientGroup(recipient = "", notes = "") {
  const text = `${recipient} ${notes}`.toLowerCase();

  const female = ["wife", "girlfriend", "mom", "mother", "sister", "daughter", "girl", "woman", "women", "her", "she"];
  const male = ["husband", "boyfriend", "dad", "father", "brother", "son", "boy", "man", "men", "him", "he"];

  const isFemale = female.some((k) => text.includes(k));
  const isMale = male.some((k) => text.includes(k));

  if (isFemale && !isMale) return "female";
  if (isMale && !isFemale) return "male";
  return "neutral";
}

function extractTimeFromNotes(notes = "") {
  const m = String(notes).match(/\b([01]?\d|2[0-3])[:.][0-5]\d\b/);
  if (!m) return null;
  return m[0].replace(".", ":");
}

function detectBrands(notesText) {
  const BRANDS = [
    "nike",
    "adidas",
    "puma",
    "new balance",
    "rolex",
    "omega",
    "cartier",
    "seiko",
    "apple",
    "sony",
    "bose",
    "lululemon",
    "chanel",
    "dior",
    "gucci",
    "prada",
    "ysl",
    "hermes",
  ];

  const found = [];
  for (const b of BRANDS) {
    if (notesText.includes(b)) found.push(b);
  }
  return found;
}

function extractRequestedPhrases(notes = "") {
  const raw = String(notes || "");
  const parts = raw
    .split(/[,|\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.slice(0, 6);
}

// ================= PROMPT BUILDER =================
function buildPrompt({ inputs, tier }) {
  const isSignature = String(tier || "").toLowerCase().includes("signature");
  const notesText = toLower(inputs.notes || "");
  const recipientGroup = inferRecipientGroup(inputs.recipient || "", inputs.notes || "");
  const requestedTime = extractTimeFromNotes(inputs.notes || "");
  const brandsFound = detectBrands(notesText);

  const wantsBrandsOrLogos =
    brandsFound.length > 0 ||
    notesText.includes("logo") ||
    notesText.includes("logos") ||
    notesText.includes("brand") ||
    notesText.includes("branded");

  const requestedPhrases = extractRequestedPhrases(inputs.notes || "");

  const MUST_INCLUDE = [];
  const NEGATIVE = [];

  const PALETTES = {
    female: "soft ivory, warm beige, blush-neutral accents, subtle gold or brass details",
    male: "charcoal, black, deep navy, warm gray, brushed metal accents",
    neutral: "ivory, stone, warm gray, charcoal accents, minimal restrained tones",
  };
  MUST_INCLUDE.push(`apply a ${recipientGroup} premium palette: ${PALETTES[recipientGroup]}`);

  if (!wantsBrandsOrLogos) {
    NEGATIVE.push("no logos", "no brand names", "no readable labels", "no readable text");
  } else {
    MUST_INCLUDE.push(
      "include visible brand logos and specific branded items ONLY as requested in Notes",
      "logos should appear authentic and clean",
      "avoid random extra brands not requested"
    );
    NEGATIVE.push("no watermarks", "no UI elements");
  }

  NEGATIVE.push(
    "no pillows",
    "no cushions",
    "no pillow-shaped items",
    "no plush pillow forms",
    "no bulky square fabric bundles",
    "no sheet masks",
    "no mini or travel-size skincare",
    "no hand cream tubes",
    "no tea lights",
    "no votive candles",
    "no loose cards",
    "no posters",
    "no unbound prints",
    "no excessive small items",
    "no decorative padding"
  );

  MUST_INCLUDE.push(
    "volume must come from structured items (rigid boxes, hard cases, ceramic/metal objects), not pillow-like textiles"
  );

  MUST_INCLUDE.push(
    "throws or blankets allowed only if folded/draped as a thin premium textile accent, not dominant and not pillow-like"
  );

  if (isSignature) {
    MUST_INCLUDE.push(
      "show a nested 3-tier gift box presentation: top box open, middle box partially visible, bottom box hinted",
      "clearly show multiple boxes and layered depth (not a single box only)"
    );
    NEGATIVE.push("no single-box-only composition");
  }

  if (isSignature) {
    MUST_INCLUDE.push(
      "include ONE dominant modern sculptural lifestyle object as the hero (ceramic, stone, resin, metal, or leather)",
      "hero object must feel trend-forward and expensive",
      "all other items must be secondary and smaller"
    );

    NEGATIVE.push(
      "no consumable item as hero",
      "no candle, skincare, fragrance, journal, or self-care item as the primary object",
      "no spa-kit look",
      "no cluttered assortment of small consumables"
    );
  }

  MUST_INCLUDE.push(
    "gift shop trinkets are allowed if premium-looking; limit to ONE small accent item; avoid cheap plastic",
    "candle sets are allowed; maximum two candles; substantial vessels; premium materials; not tea lights or votives",
    "bath bombs or lip balm allowed only as a single small secondary accent when appropriate; must not dominate",
    "soft cosmetic bags allowed only if OPEN with contents visible (no closed or zipped bags)"
  );
  NEGATIVE.push("no closed cosmetic bags", "no zipped cosmetic pouches");

  if (requestedPhrases.length) {
    MUST_INCLUDE.push(`include specific requested items from Notes when feasible: ${requestedPhrases.join("; ")}`);
  }

  if (brandsFound.length) {
    MUST_INCLUDE.push(`explicit brand requests detected: ${brandsFound.join(", ")} (only include these if shown)`);
  }

  const wantsWatch = notesText.includes("watch") || notesText.includes("timepiece") || !!requestedTime;
  if (wantsWatch) {
    MUST_INCLUDE.push(
      "include a premium wristwatch/timepiece as a visible item",
      "watch should be shown in an open presentation case or tray",
      "avoid smartwatch appearance unless explicitly requested"
    );
    NEGATIVE.push("no smartwatches unless requested");

    if (requestedTime) {
      MUST_INCLUDE.push(`watch must show the exact time ${requestedTime}`, "make the watch face large and clearly readable");
    }
  }

  return `
High-end photorealistic studio product photography of a premium AI-curated gift box experience with contents clearly visible.

Tier: ${tier}
Recipient: ${inputs.recipient}
Occasion: ${inputs.occasion}
Vibe: ${inputs.vibe || "Refined"}

STYLE:
- modern premium lifestyle aesthetic
- editorial product photography
- intentional composition with negative space
- realistic materials and textures
- avoid random clutter

MUST INCLUDE:
- ${MUST_INCLUDE.join("; ")}

NEGATIVE CONSTRAINTS:
- ${NEGATIVE.join(", ")}

Notes (user intent; treat as requests ONLY when explicitly stated):
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
    const { inputs: rawInputs, sessionId, tier = "Curated" } = req.body || {};
    if (!rawInputs || !sessionId) {
      return res.status(400).json({ error: "Missing inputs or sessionId" });
    }

    const used = generationCount.get(sessionId) || 0;
    if (used >= MAX_GENERATIONS) {
      return res.status(429).json({ error: "Generation limit reached" });
    }

    // ✅ Canonicalize inputs from either canonical keys OR label-based keys
    const inputs = coerceInputs(rawInputs);

    const prompt = buildPrompt({ inputs, tier });

    const output = await replicate.run(process.env.REPLICATE_MODEL || "black-forest-labs/flux-dev", {
      input: {
        prompt,
        aspect_ratio: "1:1",
        output_format: "webp",
        quality: 90,
      },
    });

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
