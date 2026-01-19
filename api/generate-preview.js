// /api/generate-preview.js
// Meaningfull™ AI Preview — MVP (Robust Option-Set Key Mapping + Notes Focus Mode)
// Engine: Replicate (Flux)
// SAFE for Shopify + Vercel
//
// ✅ Supports BOTH old + new OptionSet field titles (locked keys)
// ✅ Notes ("Anything you'd like us to know?") now supports:
//    - Explicit exclusions: "no candles", "don't include socks", "exclude skincare"
//    - Focus mode: explicit inclusions/items/brands in Notes become PRIMARY driver
// ✅ Optional brand constraints via env vars (MVP-safe)
//
// Env (optional):
// - REPLICATE_API_TOKEN
// - REPLICATE_MODEL (default: black-forest-labs/flux-dev)
// - MEANINGFULL_ALLOWED_BRANDS="nike,adidas,bose"   (empty => default no brands/logos in strict mode)
// - MEANINGFULL_DISALLOWED_BRANDS="rolex,gucci"
// - MEANINGFULL_STRICT_BRAND_MODE="true"            (default true)

const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ================= CONFIG =================
const MAX_GENERATIONS = 2;
const generationCount = new Map();

// ================= CONSTRAINTS (MVP) =================
const CONSTRAINTS = {
  ALLOWED_BRANDS: (process.env.MEANINGFULL_ALLOWED_BRANDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  DISALLOWED_BRANDS: (process.env.MEANINGFULL_DISALLOWED_BRANDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // If true: NEVER allow brands/logos unless explicitly requested AND permitted.
  STRICT_BRAND_MODE: (process.env.MEANINGFULL_STRICT_BRAND_MODE || "true").toLowerCase() === "true",
};

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

/**
 * Brand detection from notes (NOT permission).
 * Returns requested/permitted/blocked using CONSTRAINTS.
 */
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

  const requested = [...new Set(found)];

  const disallowed = new Set(CONSTRAINTS.DISALLOWED_BRANDS);
  const allowed = new Set(CONSTRAINTS.ALLOWED_BRANDS);

  const blocked = requested.filter((b) => disallowed.has(b) || (allowed.size > 0 && !allowed.has(b)));
  const permitted = requested.filter((b) => !blocked.includes(b));

  return { requested, permitted, blocked };
}

function extractRequestedPhrases(notes = "") {
  const raw = String(notes || "");
  const parts = raw
    .split(/[,|\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.slice(0, 6);
}

/**
 * Explicit exclusions: "no candles", "don't include socks", "exclude skincare", "without fragrance"
 * Returns array of phrases (lowercased).
 */
function extractExplicitExclusions(notes = "") {
  const text = String(notes || "").toLowerCase();

  const patterns = [
    /\bno\s+([a-z\s-]{3,30})/g,
    /\bdon'?t\s+include\s+([a-z\s-]{3,30})/g,
    /\bexclude\s+([a-z\s-]{3,30})/g,
    /\bwithout\s+([a-z\s-]{3,30})/g,
  ];

  const found = new Set();

  for (const re of patterns) {
    let match;
    while ((match = re.exec(text)) !== null) {
      const item = match[1].replace(/[^a-z\s-]/g, "").trim();
      if (item.length >= 3) found.add(item);
    }
  }

  return Array.from(found).slice(0, 8);
}

/**
 * Explicit inclusions / focus:
 * - "must include X", "include X", "add X", "focus on X", "want X", "looking for X"
 * PLUS list-style comma/newline phrases as "possible includes".
 */
function extractExplicitInclusions(notes = "") {
  const text = String(notes || "");

  const patterns = [
    /\bmust\s+include\s+([^.\n]{3,80})/gi,
    /\binclude\s+([^.\n]{3,80})/gi,
    /\badd\s+([^.\n]{3,80})/gi,
    /\bfocus\s+on\s+([^.\n]{3,80})/gi,
    /\bwant\s+([^.\n]{3,80})/gi,
    /\blooking\s+for\s+([^.\n]{3,80})/gi,
  ];

  const found = [];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      found.push(m[1]);
    }
  }

  const listStyle = extractRequestedPhrases(text);

  const merged = []
    .concat(found)
    .concat(listStyle)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 8);

  return merged;
}

// ================= PROMPT BUILDER =================
function buildPrompt({ inputs, tier }) {
  const isSignature = String(tier || "").toLowerCase().includes("signature");
  const notesText = toLower(inputs.notes || "");
  const recipientGroup = inferRecipientGroup(inputs.recipient || "", inputs.notes || "");
  const requestedTime = extractTimeFromNotes(inputs.notes || "");

  const brandScan = detectBrands(notesText);
  const permittedBrands = brandScan.permitted || [];
  const blockedBrands = brandScan.blocked || [];

  const requestedPhrases = extractRequestedPhrases(inputs.notes || "");
  const explicitExclusions = extractExplicitExclusions(inputs.notes || "");
  const explicitInclusions = extractExplicitInclusions(inputs.notes || "");

  // Exclusions win if a phrase matches exactly
  const exclusionsSet = new Set(explicitExclusions.map((s) => s.toLowerCase()));
  const inclusionsFiltered = explicitInclusions.filter((s) => !exclusionsSet.has(String(s).toLowerCase()));

  // Focus mode triggers if Notes has specific inclusions OR brand requests
  const hasUserSpecificFocus = inclusionsFiltered.length > 0 || permittedBrands.length > 0;

  const requestedBrandWords =
    notesText.includes("logo") ||
    notesText.includes("logos") ||
    notesText.includes("brand") ||
    notesText.includes("branded");

  const wantsBrandsOrLogos = CONSTRAINTS.STRICT_BRAND_MODE
    ? permittedBrands.length > 0 // strict: must have permitted explicit requests
    : permittedBrands.length > 0 || requestedBrandWords; // loose: allow if user asks generally and we have any permitted

  const MUST_INCLUDE = [];
  const NEGATIVE = [];

  const PALETTES = {
    female: "soft ivory, warm beige, blush-neutral accents, subtle gold or brass details",
    male: "charcoal, black, deep navy, warm gray, brushed metal accents",
    neutral: "ivory, stone, warm gray, charcoal accents, minimal restrained tones",
  };
  MUST_INCLUDE.push(`apply a ${recipientGroup} premium palette: ${PALETTES[recipientGroup]}`);

  // Branding / text control
  if (!wantsBrandsOrLogos) {
    NEGATIVE.push("no logos", "no brand names", "no readable labels", "no readable text", "no typography");
  } else {
    MUST_INCLUDE.push(
      "include visible brand logos and specific branded items ONLY if explicitly requested and permitted",
      "avoid random extra brands not requested",
      "no invented brands"
    );
    NEGATIVE.push("no watermarks", "no UI elements", "no extra brand logos");
  }

  // If user requested blocked brands, explicitly forbid them
  if (blockedBrands.length) {
    NEGATIVE.push(`no ${blockedBrands.join(" brand, no ")} brand`);
    NEGATIVE.push("no luxury designer branding unless explicitly permitted");
  }

  // Default hard negatives (your current block)
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

  // Tier composition blueprint
  if (isSignature) {
    MUST_INCLUDE.push(
      "show a nested 3-tier gift box presentation: top box open, middle box partially visible, bottom box hinted",
      "clearly show multiple boxes and layered depth (not a single box only)",
      "include ONE dominant modern sculptural lifestyle object as the hero (ceramic, stone, resin, metal, or leather)",
      "hero object must feel trend-forward and expensive",
      "all other items must be secondary and smaller"
    );
    NEGATIVE.push(
      "no single-box-only composition",
      "no consumable item as hero",
      "no candle, skincare, fragrance, journal, or self-care item as the primary object",
      "no spa-kit look",
      "no cluttered assortment of small consumables"
    );
  } else {
    // Curated (default) blueprint: clearer composition target
    MUST_INCLUDE.push("show one premium gift box open with contents clearly visible; 3–6 items max; strong negative space");
    NEGATIVE.push("no cluttered overflowing box");
  }

  // Allowed items guidance (kept, but Focus Mode can tighten)
  MUST_INCLUDE.push(
    "gift shop trinkets are allowed if premium-looking; limit to ONE small accent item; avoid cheap plastic",
    "candle sets are allowed; maximum two candles; substantial vessels; premium materials; not tea lights or votives",
    "bath bombs or lip balm allowed only as a single small secondary accent when appropriate; must not dominate",
    "soft cosmetic bags allowed only if OPEN with contents visible (no closed or zipped bags)"
  );
  NEGATIVE.push("no closed cosmetic bags", "no zipped cosmetic pouches");

  // Notes list-style phrases should be prioritized (stronger than before)
  if (requestedPhrases.length) {
    MUST_INCLUDE.push(`user-requested items from Notes should be included and prioritized: ${requestedPhrases.join("; ")}`);
  }

  // Brand summary (constrained)
  if (permittedBrands.length) {
    MUST_INCLUDE.push(`permitted brand requests: ${permittedBrands.join(", ")} (include ONLY these, if shown)`);
  }
  if (blockedBrands.length) {
    MUST_INCLUDE.push(`blocked brand requests detected (DO NOT include): ${blockedBrands.join(", ")}`);
  }

  // Watch logic
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

  // Focus Mode: when Notes contains specific items/brands, center the composition around them
  if (hasUserSpecificFocus) {
    if (inclusionsFiltered.length) {
      MUST_INCLUDE.push(
        `PRIMARY FOCUS: the gift composition must center around these user-requested items/brands from Notes: ${inclusionsFiltered.join(
          "; "
        )}`,
        "do not substitute with random alternatives if the requested items can be shown",
        "any non-requested items must be minimal, generic, and secondary",
        "avoid filler items that dilute the requested focus"
      );
    } else {
      MUST_INCLUDE.push(
        "PRIMARY FOCUS: center composition tightly on the user-requested specifics from Notes (avoid generic filler)"
      );
    }

    if (wantsBrandsOrLogos) {
      MUST_INCLUDE.push("if a brand is explicitly requested in Notes and permitted, show only that brand (no extra brands)");
      NEGATIVE.push("no additional brands beyond the requested/permitted set");
    }

    NEGATIVE.push("no random extra categories not requested", "no unrelated novelty items");
  }

  // Explicit user exclusions are strict and override defaults (including candle allowance etc.)
  if (explicitExclusions.length) {
    explicitExclusions.forEach((item) => {
      NEGATIVE.push(`no ${item}`);
    });
    MUST_INCLUDE.push("user-specified exclusions are strict and must be followed exactly");
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
- no readable text anywhere unless explicitly requested

MUST INCLUDE:
- ${MUST_INCLUDE.join("; ")}

NEGATIVE CONSTRAINTS:
- ${NEGATIVE.join(", ")}

Notes (user intent; treat exclusions as strict and inclusions as primary focus when specific):
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

