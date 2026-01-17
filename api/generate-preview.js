// api/generate-preview.js
// Meaningfull™ AI Preview — Vercel Serverless Function (CommonJS)
//
// ✅ Replicate (Flux) image generation
// ✅ CORS + OPTIONS (Shopify-friendly)
// ✅ Max 2 generations per sessionId (MVP in-memory)
// ✅ Occasion + Recipient motifs drive item content
// ✅ Notes ("Anything else") actively influences output (age + keywords + exclusions)
// ✅ MULTIPLE OPEN BOXES (nested set) + NO EMPTY/CLOSED boxes
// ✅ Minimum items per box = 4
// ✅ Halloween: spooky + horror + classic horror movie vibe (no gore)

const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MAX_GENERATIONS = 2;
const generationCount = new Map();

// ---- CORS ----
function setCors(res) {
  // MVP: allow all. For launch-hardening, set to "https://meaningfull.co"
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---- Notes parsing helpers (Anything else) ----
function extractAge(notes = "") {
  const m = String(notes).match(/(\d{1,2})\s*(?:yo|y\/o|years?\s*old)/i);
  if (!m) return null;
  const age = Number(m[1]);
  return Number.isFinite(age) ? age : null;
}

function buildNotesRules(notes = "") {
  const raw = String(notes || "");
  const n = raw.toLowerCase();

  const hard = [];
  const avoid = [];

  // Age -> strong constraint
  const age = extractAge(raw);
  if (age !== null) {
    if (age <= 3) hard.push("infant/toddler-appropriate items only; baby-safe, soft, gentle, non-choking-size items");
    else if (age <= 12) hard.push("kid-appropriate items only; playful, fun, absolutely no adult themes");
    else if (age <= 17) hard.push("teen-appropriate items; trendy, cool, still safe and age-appropriate");
    else hard.push("adult-appropriate items");
  }

  // Explicit exclusions (simple pattern)
  // Examples users type: "no chocolate", "dont include alcohol", "avoid nuts"
  const noPhrases = [
    { key: "alcohol", rule: "no alcohol" },
    { key: "chocolate", rule: "no chocolate items" },
    { key: "nuts", rule: "avoid nuts" },
    { key: "perfume", rule: "avoid perfume/fragrance items" },
  ];
  for (const p of noPhrases) {
    if (n.includes(`no ${p.key}`) || n.includes(`don't include ${p.key}`) || n.includes(`dont include ${p.key}`) || n.includes(`avoid ${p.key}`)) {
      avoid.push(p.rule);
    }
  }

  // Interest nudges (visual nouns help the model)
  const interests = [
    { keys: ["sports", "soccer", "basketball", "hockey"], rule: "include subtle sports-themed gift items appropriate to the recipient" },
    { keys: ["music", "guitar", "piano", "concert", "vinyl"], rule: "include subtle music-themed gift items appropriate to the recipient" },
    { keys: ["gaming", "video game", "playstation", "xbox", "nintendo"], rule: "include subtle gaming-themed gift items appropriate to the recipient" },
    { keys: ["skincare", "self care", "spa"], rule: "include subtle skincare/self-care themed items appropriate to the recipient" },
    { keys: ["coffee", "espresso", "tea"], rule: "include subtle coffee/tea themed items appropriate to the recipient" },
    { keys: ["books", "reading", "novel"], rule: "include subtle book/reading themed items appropriate to the recipient" },
    { keys: ["cats", "cat"], rule: "include subtle cat-themed items (only if recipient is a pet-lover; keep tasteful)" },
    { keys: ["dogs", "dog"], rule: "include subtle dog-themed items (only if recipient is a pet-lover; keep tasteful)" },
  ];
  for (const it of interests) {
    if (it.keys.some(k => n.includes(k))) {
      hard.push(it.rule);
      break;
    }
  }

  // If user says "surprise me" (and nothing else useful)
  if ((n.includes("surprise me") || n.includes("surprise")) && hard.length === 0 && age === null) {
    hard.push("choose a balanced, universally appealing mix of items appropriate for the occasion and recipient");
  }

  return { hard, avoid, age, raw };
}

// ✅ Match your EasyFlow option text EXACTLY (case/spacing)
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
    "spooky and horror influence without gore",
    "classic horror movie vibe (retro cinematic lighting, moody shadows, vintage horror aesthetic)",
    "pumpkin/orange/black accents, eerie candlelight, foggy ambience",
    "include subtle classic horror props (unbranded): old film reel, vintage VHS tape, gothic candle, small skull figurine"
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
  // Keep your existing values + add common expansions
  "Boyfriend": ["romantic but tasteful items appropriate for a boyfriend; not stereotypical"],
  "Girlfriend": ["romantic but tasteful items appropriate for a girlfriend; not stereotypical"],
  "Husband": ["mature, refined, practical + sentimental mix appropriate for a husband"],
  "Wife": ["mature, refined, sentimental + elegant mix appropriate for a wife"],
  "Someone I'm dating": ["early-relationship appropriate (sweet, not intense), polished and safe"],
  "Friend": ["friendly, fun, not romantic, universally likeable items"],
  "Sibling": ["playful, casual, non-romantic items, fun but thoughtful"],
  "Mom": ["warm, caring, elevated comfort vibe, appreciative touches"],
  "Dad": ["warm, practical, classic vibe, appreciative touches"],
  "Parent": ["warm, appreciative, elevated comfort vibe; practical + sentimental mix"],
  "Son": ["kid-appropriate items; playful and fun; no adult themes"],
  "Daughter": ["kid-appropriate items; warm and playful; no adult themes"],
  "Relative": ["neutral, family-friendly items; avoid romantic themes"],
  "My Pet": ["pet-themed items visible; treats, toys, accessories; cute but premium"]
};

// Optional vibe tightening
const VIBE_STYLE = {
  "Minimalist": [
    "minimal, uncluttered composition",
    "neutral or soft muted palette",
    "clean premium packaging"
  ],
  "Luxury": [
    "high-end premium look",
    "richer textures",
    "elevated presentation"
  ],
  "Playful": [
    "brighter accents",
    "fun, lively styling"
  ],
  "Surprise me": [
    "balanced, universally appealing styling that matches the occasion"
  ]
};

module.exports = async (req, res) => {
  setCors(res);

  // ✅ Preflight support for Shopify
  if (req.method === "OPTIONS") return res.status(200).end();

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

    // ---- Strong “multi-box + min items” constraints ----
    const BOX_COUNT = 3;           // multiple boxes (nested set)
    const MIN_ITEMS_PER_BOX = 4;   // minimum items per box

    const occasionRulesArr = OCCASION_MOTIFS[inputs.occasion] || ["items should clearly match the occasion"];
    const recipientRulesArr = RECIPIENT_MOTIFS[inputs.recipient] || ["items should clearly match the recipient type"];
    const vibeRulesArr = VIBE_STYLE[inputs.vibe] || ["styling should match the selected vibe"];

    const notesRules = buildNotesRules(inputs.notes || "");

    // Must-include reinforcement (reduces misses)
    const MUST_INCLUDE = [];
    MUST_INCLUDE.push(
      `show ${BOX_COUNT} open nested boxes (top, middle, bottom), each box open with contents visible`,
      `at least ${MIN_ITEMS_PER_BOX} distinct items clearly visible in EACH box (minimum total items visible: ${BOX_COUNT * MIN_ITEMS_PER_BOX})`,
      "items should be separated enough to count visually (not hidden under tissue)",
      "include some items peeking out for depth, but do not clutter the frame"
    );

    if (inputs.occasion === "Baby shower") {
      MUST_INCLUDE.push("include at least TWO baby items clearly visible: onesie, baby bottle, pacifier, baby blanket, plush toy");
    }
    if (inputs.recipient === "My Pet") {
      MUST_INCLUDE.push("include pet items clearly visible: pet treats, toy, collar or accessory");
    }

    // Safety / quality negatives (and your “no empty/closed” guarantee)
    const NEGATIVE = [
      "no empty boxes",
      "no closed lids",
      "no sealed packaging",
      "no boxes without visible contents",
      "no fully closed gift boxes",
      "no minimalist empty packaging-only shots",
      "no text",
      "no logos",
      "no watermarks",
      "no explicit content",
      "no alcohol",
      "no weapons",
      "no lingerie",
      "no cigarettes or drugs",
      "no gore",
      "no graphic violence"
    ];

    // Add “avoid” rules from Notes
    if (notesRules.avoid.length) {
      NEGATIVE.push(...notesRules.avoid);
    }

    // Halloween: allow spooky/horror tone but keep it safe (no gore)
    // (We already included this in OCCASION_MOTIFS["Halloween"] and NEGATIVE blocks.)

    const prompt = `
Photorealistic product photography of a premium nested gift box set with items clearly visible.

Occasion: ${inputs.occasion}
Recipient: ${inputs.recipient}
Vibe: ${inputs.vibe || "Not specified"}

HARD CONSTRAINTS:
- the gift box must be OPEN with the lid removed or pushed aside
- items inside the boxes must be clearly visible at first glance
- ${MUST_INCLUDE.join("; ")}
- ${occasionRulesArr.join("; ")}
- ${recipientRulesArr.join("; ")}
- ${vibeRulesArr.join("; ")}
- ${notesRules.hard.length ? notesRules.hard.join("; ") : "use notes to meaningfully influence items when specific"}
- tasteful, premium, ready-to-gift presentation
- realistic lighting, realistic textures, studio/product photo look
- show items that obviously communicate the occasion (not subtle)

NEGATIVE CONSTRAINTS:
- ${NEGATIVE.join(", ")}

Notes (user text, treat as constraints when specific):
${notesRules.raw || "None"}

Social context (subtle influence only):
${inputs.social || "None"}
`.trim();

    const output = await replicate.run("black-forest-labs/flux-dev", {
      input: {
        prompt,
        aspect_ratio: "1:1",
        output_format: "webp",
        quality: 85
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
