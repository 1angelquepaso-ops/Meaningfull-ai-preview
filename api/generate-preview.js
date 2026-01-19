```js
// /api/generate-preview.js
// Meaningfull™ AI Preview — MVP (Robust Option-Set Key Mapping + Canonical Notes Parsing)
// Engine: Replicate (Flux)
// SAFE for Shopify + Vercel
//
// ✅ Supports BOTH old + new OptionSet field titles (locked keys)
// ✅ Notes ("Anything you'd like us to know?") now supports:
//    - Canonical AVOID items (robust): "don't include candles 14 years old" => candles
//    - Canonical MUST INCLUDE items (robust): "reebok hat" => hat (focus mode)
//    - Focus Mode: if MUST INCLUDE is detected, composition centers on it
// ✅ Optional brand constraints via env vars (MVP-safe)
// ✅ Improved error handling: returns clear JSON errors instead of silent failures
//
// Env (optional):
// - REPLICATE_API_TOKEN
// - REPLICATE_MODEL (default: black-forest-labs/flux-dev)
// - MEANINGFULL_ALLOWED_BRANDS="nike,adidas,bose"
// - MEANINGFULL_DISALLOWED_BRANDS="rolex,gucci"
// - MEANINGFULL_STRICT_BRAND_MODE="true" (default true)

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
    "reebok",
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

// ================= CANONICAL ITEM TAXONOMY =================
const INCLUDE_LABEL = {
  watch: "premium wristwatch/timepiece (analog unless requested otherwise)",
  wallet: "premium wallet or card holder",
  jewelry: "premium jewelry (necklace/bracelet/ring/earrings as appropriate)",
  sneakers: "premium sneakers/shoes (clean, elevated)",
  hoodie: "premium hoodie/sweatshirt",
  sweater: "premium sweater/knit",
  jacket: "premium jacket/outerwear accent",
  hat: "premium hat/cap/beanie (structured, elevated)",
  headphones: "premium headphones/earbuds",
  speaker: "premium speaker (minimal, modern)",
  bag: "premium bag (tote/handbag/backpack as appropriate)",
  sunglasses: "premium sunglasses",
  belt: "premium belt",
  scarf: "premium scarf",
  book: "book (premium edition aesthetic)",
  journal: "journal/notebook (minimal, premium)",
  mug: "ceramic mug/cup (premium, minimal)",
  bottle: "premium tumbler/water bottle",
  decor: "modern sculptural decor object (ceramic/stone/metal)",
  tech_accessory: "tech accessory (charging dock/phone accessory; minimal; no text)",
  fitness: "fitness accessory (premium, minimal; no cheap plastic)",
  travel: "travel accessory (passport cover/luggage tag; minimal; no text)",
};

const CANONICAL_INCLUDE = {
  watch: ["watch", "timepiece", "analog watch"],
  wallet: ["wallet", "card holder", "cardholder"],
  jewelry: ["jewelry", "necklace", "bracelet", "ring", "earrings"],
  sneakers: ["sneakers", "sneaker", "shoes", "shoe", "trainers"],
  hoodie: ["hoodie", "sweatshirt"],
  sweater: ["sweater", "knit"],
  jacket: ["jacket", "coat", "outerwear"],
  hat: ["hat", "cap", "beanie"],
  headphones: ["headphones", "earbuds", "earphones", "airpods"],
  speaker: ["speaker", "bluetooth speaker"],
  bag: ["bag", "handbag", "tote", "backpack"],
  sunglasses: ["sunglasses", "shades"],
  belt: ["belt"],
  scarf: ["scarf"],
  book: ["book", "novel"],
  journal: ["journal", "notebook"],
  mug: ["mug", "cup"],
  bottle: ["water bottle", "tumbler"],
  decor: ["decor", "sculpture", "ceramic object", "vase", "tray", "bowl"],
  tech_accessory: ["charger", "charging dock", "phone accessory"],
  fitness: ["gym", "workout", "fitness", "yoga"],
  travel: ["travel", "luggage tag", "passport cover"],
};

const CANONICAL_AVOID = {
  candles: ["candle", "candles", "tealight", "tealights", "votive", "wax"],
  skincare: ["skincare", "serum", "lotion", "face mask", "sheet mask", "moisturizer", "hand cream", "cream"],
  fragrance: ["fragrance", "perfume", "cologne"],
  socks: ["socks"],
  hats: ["hat", "cap", "beanie"],
  plush: ["plush", "stuffed", "stuffed animal"],
  pillow: ["pillow", "cushion"],
  blanket: ["blanket", "throw"],
  soap: ["soap", "body wash"],
  bath: ["bath bomb", "bath bombs", "loofah"],
  alcohol: ["alcohol", "wine", "beer", "spirits"],
  food: ["food", "snack", "snacks", "candy", "chocolate"],
  paper: ["card", "greeting card", "poster", "print", "prints", "sticker", "stickers"],
  clutter: ["cheap", "plastic", "novelty", "gag gift"],
};

function extractCanonicalTags(notes = "") {
  const text = String(notes || "").toLowerCase();

  const includes = new Set();
  const avoids = new Set();

  // AVOID detection (explicit only)
  const exclusionPatterns = [
    /\bno\s+([a-z\s-]{3,60})/g,
    /\bdon'?t\s+include\s+([a-z\s-]{3,60})/g,
    /\bexclude\s+([a-z\s-]{3,60})/g,
    /\bwithout\s+([a-z\s-]{3,60})/g,
  ];

  const exclusionPhrases = [];
  for (const re of exclusionPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) exclusionPhrases.push(m[1]);
  }

  for (const phrase of exclusionPhrases) {
    for (const [key, synonyms] of Object.entries(CANONICAL_AVOID)) {
      if (synonyms.some((s) => phrase.includes(s))) avoids.add(key);
    }
  }

  // INCLUDE detection (explicit OR list-style)
  const inclusionPatterns = [
    /\bmust\s+include\s+([^.\n]{3,120})/gi,
    /\binclude\s+([^.\n]{3,120})/gi,
    /\badd\s+([^.\n]{3,120})/gi,
    /\bfocus\s+on\s+([^.\n]{3,120})/gi,
    /\bwant\s+([^.\n]{3,120})/gi,
    /\blooking\s+for\s+([^.\n]{3,120})/gi,
  ];

  const inclusionPhrases = [];

  for (const re of inclusionPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) inclusionPhrases.push(m[1]);
  }

  const listStyle = text.split(/[,|\n]/g).map((s) => s.trim());
  inclusionPhrases.push(...listStyle);

  for (const phrase of inclusionPhrases) {
    for (const [key, synonyms] of Object.entries(CANONICAL_INCLUDE)) {
      if (synonyms.some((s) => phrase.includes(s))) includes.add(key);
    }
  }

  return {
    includes: Array.from(includes).slice(0, 6),
    avoids: Array.from(avoids).slice(0, 6),
  };
}

// ================= PROMPT BUILDER =================
function buildPrompt({ inputs, tier }) {
  const isSignature = String(tier || "").toLowerCase().includes("signature");
  const notesText = toLower(inputs.notes || "");
  const recipientGroup = inferRecipientGroup(inputs.recipient || "", inputs.notes || "");
  const requestedTime = extractTimeFromNotes(inputs.notes || "");

  const canonical = extractCanonicalTags(inputs.notes || "");
  const avoidSet = new Set(canonical.avoids.map((x) => String(x).toLowerCase()));
  const hasUserSpecificFocus = canonical.includes.length > 0;

  // Brand logic
  const brandScan = detectBrands(notesText);
  const permittedBrands = brandScan.permitted || [];
  const blockedBrands = brandScan.blocked || [];

  const requestedBrandWords =
    notesText.includes("logo") ||
    notesText.includes("logos") ||
    notesText.includes("brand") ||
    notesText.includes("branded");

  const wantsBrandsOrLogos = CONSTRAINTS.STRICT_BRAND_MODE
    ? permittedBrands.length > 0
    : permittedBrands.length > 0 || requestedBrandWords;

  const MUST_INCLUDE = [];
  const NEGATIVE = [];

  const PALETTES = {
    female: "soft ivory, warm beige, blush-neutral accents, subtle gold or brass details",
    male: "charcoal, black, deep navy, warm gray, brushed metal accents",
    neutral: "ivory, stone, warm gray, charcoal accents, minimal restrained tones",
  };
  MUST_INCLUDE.push(`apply a ${recipientGroup} premium palette: ${PALETTES[recipientGroup]}`);

  // Text/logo control
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

  if (blockedBrands.length) {
    NEGATIVE.push(`no ${blockedBrands.join(" brand, no ")} brand`);
    NEGATIVE.push("no luxury designer branding unless explicitly permitted");
  }

  // Global hard negatives
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

  // Tier blueprint
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
    MUST_INCLUDE.push("show one premium gift box open with contents clearly visible; 3–6 items max; strong negative space");
    NEGATIVE.push("no cluttered overflowing box");
  }

  // Allowed guidance (overridden by avoids)
  MUST_INCLUDE.push(
    "gift shop trinkets are allowed if premium-looking; limit to ONE small accent item; avoid cheap plastic",
    "bath bombs or lip balm allowed only as a single small secondary accent when appropriate; must not dominate",
    "soft cosmetic bags allowed only if OPEN with contents visible (no closed or zipped bags)"
  );
  NEGATIVE.push("no closed cosmetic bags", "no zipped cosmetic pouches");

  // Candles conditional
  if (!avoidSet.has("candles")) {
    MUST_INCLUDE.push(
      "candle sets are allowed; maximum two candles; substantial vessels; premium materials; not tea lights or votives"
    );
  } else {
    NEGATIVE.push("no candles", "no candle-like objects", "no wax items");
  }

  // Canonical avoid expansions
  if (avoidSet.has("skincare")) NEGATIVE.push("no skincare", "no lotions", "no creams", "no serums", "no masks");
  if (avoidSet.has("fragrance")) NEGATIVE.push("no fragrance", "no perfume", "no cologne");
  if (avoidSet.has("socks")) NEGATIVE.push("no socks");
  if (avoidSet.has("hats")) NEGATIVE.push("no hats", "no caps", "no beanies");
  if (avoidSet.has("plush")) NEGATIVE.push("no plush", "no stuffed animals");
  if (avoidSet.has("pillow")) NEGATIVE.push("no pillows", "no cushions");
  if (avoidSet.has("blanket")) NEGATIVE.push("no blankets", "no throws");
  if (avoidSet.has("paper")) NEGATIVE.push("no greeting cards", "no paper inserts", "no posters", "no prints");
  if (avoidSet.has("alcohol")) NEGATIVE.push("no alcohol", "no wine", "no spirits");
  if (avoidSet.has("food")) NEGATIVE.push("no food", "no snacks", "no candy", "no chocolate");
  if (avoidSet.has("clutter")) NEGATIVE.push("no cheap plastic", "no novelty items", "no gag gifts");

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

  // Focus Mode: MUST INCLUDE items become primary driver
  if (hasUserSpecificFocus) {
    const focusItems = canonical.includes.map((k) => INCLUDE_LABEL[k] || k);
    MUST_INCLUDE.push(
      `PRIMARY FOCUS ITEMS (from Notes): ${focusItems.join("; ")}`,
      "center the composition around these items",
      "any non-requested items must be minimal, generic, and secondary",
      "avoid filler items that dilute the requested focus"
    );
    NEGATIVE.push("no random extra categories not requested", "no unrelated novelty items");

    if (wantsBrandsOrLogos) {
      MUST_INCLUDE.push("if a brand is explicitly requested in Notes and permitted, show only that brand (no extra brands)");
      NEGATIVE.push("no additional brands beyond the requested/permitted set");
    }
  }

  if (permittedBrands.length) {
    MUST_INCLUDE.push(`permitted brand requests: ${permittedBrands.join(", ")} (include ONLY these, if shown)`);
  }
  if (blockedBrands.length) {
    MUST_INCLUDE.push(`blocked brand requests detected (DO NOT include): ${blockedBrands.join(", ")}`);
  }

  MUST_INCLUDE.push("no readable text anywhere unless explicitly requested");

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

Notes (user intent; canonical MUST INCLUDE becomes primary focus; explicit AVOID is strict):
${inputs.notes || "None"}
`.trim();
}

// ================= HANDLER (Improved Errors) =================
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN in environment" });
    }

    const { inputs: rawInputs, sessionId, tier = "Curated" } = req.body || {};
    if (!rawInputs || !sessionId) {
      return res.status(400).json({ error: "Missing inputs or sessionId" });
    }

    const used = generationCount.get(sessionId) || 0;
    if (used >= MAX_GENERATIONS) {
      return res.status(429).json({ error: "Generation limit reached" });
    }

    const inputs = coerceInputs(rawInputs);
    const prompt = buildPrompt({ inputs, tier });

    const model = process.env.REPLICATE_MODEL || "black-forest-labs/flux-dev";

    let output;
    try {
      output = await replicate.run(model, {
        input: {
          prompt,
          aspect_ratio: "1:1",
          output_format: "webp",
          quality: 90,
        },
      });
    } catch (e) {
      console.error("Replicate.run error:", e);
      return res.status(502).json({
        error: "Replicate request failed",
        details: e?.message || String(e),
      });
    }

    let imageUrl = null;
    if (typeof output === "string") imageUrl = output;
    else if (Array.isArray(output) && output.length) imageUrl = output[0];
    else if (output && typeof output === "object") {
      if (Array.isArray(output.output) && output.output.length) imageUrl = output.output[0];
      if (!imageUrl && Array.isArray(output.images) && output.images.length) imageUrl = output.images[0];
      if (!imageUrl && typeof output.url === "string") imageUrl = output.url;
    }

    if (!imageUrl || typeof imageUrl !== "string") {
      console.error("No imageUrl in replicate output:", output);
      return res.status(502).json({
        error: "No image returned from model",
        details: "Replicate returned an unexpected/empty output",
      });
    }

    generationCount.set(sessionId, used + 1);

    return res.status(200).json({
      ok: true,
      tier,
      used: used + 1,
      imageUrl,
    });
  } catch (err) {
    console.error("Preview generation failed:", err);
    return res.status(500).json({
      error: "Generation failed",
      details: err?.message || String(err),
    });
  }
};
```
