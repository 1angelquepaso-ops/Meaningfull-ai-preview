// /api/generate-preview.js
// Meaningfull™ AI Preview — Combined (Replicate OR OpenAI) + CORS + session limit + (optional) vision validation

const Replicate = require("replicate");

// --- Config ---
const MAX_GENERATIONS = 2;
const generationCount = new Map();

const PREVIEW_ENGINE = (process.env.PREVIEW_ENGINE || "replicate").toLowerCase();
// replicate | openai

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ---- CORS ----
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// -------------------- Notes parsing helpers (from Code 1) --------------------
function extractAge(notes = "") {
  const m = String(notes).match(/(\d{1,2})\s*(?:yo|y\/o|years?\s*old)/i);
  if (!m) return null;
  const age = Number(m[1]);
  return Number.isFinite(age) ? age : null;
}

function extractColorsFree(notes = "") {
  const n = String(notes).toLowerCase();
  const COLOR_WORDS = [
    "black","white","gray","grey","silver","gold",
    "red","blue","navy","pink","purple","violet","lavender",
    "green","emerald","sage","teal",
    "yellow","orange",
    "brown","beige","cream",
    "pastel","neon"
  ];
  const found = [];
  for (const c of COLOR_WORDS) {
    const re = new RegExp(`\\b${c}\\b`, "i");
    if (re.test(n)) found.push(c);
  }
  return Array.from(new Set(found));
}

function buildNotesRules(notes = "") {
  const raw = String(notes || "");
  const n = raw.toLowerCase();

  const hard = [];
  const avoid = [];

  const age = extractAge(raw);
  if (age !== null) {
    if (age <= 3) hard.push("infant/toddler-appropriate items only; baby-safe, soft, gentle, non-choking-size items");
    else if (age <= 12) hard.push("kid-appropriate items only; playful, fun, absolutely no adult themes");
    else if (age <= 17) hard.push("teen-appropriate items; trendy, cool, still safe and age-appropriate");
    else hard.push("adult-appropriate items");
  }

  const noPhrases = [
    { key: "alcohol", rule: "no alcohol" },
    { key: "chocolate", rule: "no chocolate items" },
    { key: "nuts", rule: "avoid nuts" },
    { key: "perfume", rule: "avoid perfume/fragrance items" },
    { key: "fragrance", rule: "avoid perfume/fragrance items" },
  ];
  for (const p of noPhrases) {
    if (
      n.includes(`no ${p.key}`) ||
      n.includes(`don't include ${p.key}`) ||
      n.includes(`dont include ${p.key}`) ||
      n.includes(`avoid ${p.key}`)
    ) {
      avoid.push(p.rule);
    }
  }

  const interests = [
    { keys: ["sports", "soccer", "basketball", "hockey"], rule: "include subtle sports-themed gift items appropriate to the recipient" },
    { keys: ["music", "guitar", "piano", "concert", "vinyl"], rule: "include subtle music-themed gift items appropriate to the recipient" },
    { keys: ["gaming", "video game", "playstation", "xbox", "nintendo"], rule: "include subtle gaming-themed gift items appropriate to the recipient" },
    { keys: ["skincare", "self care", "spa"], rule: "include subtle skincare/self-care themed items appropriate to the recipient" },
    { keys: ["coffee", "espresso", "tea"], rule: "include subtle coffee/tea themed gift items appropriate to the recipient" },
    { keys: ["books", "reading", "novel"], rule: "include subtle book/reading themed gift items appropriate to the recipient" },
  ];
  for (const it of interests) {
    if (it.keys.some(k => n.includes(k))) {
      hard.push(it.rule);
      break;
    }
  }

  const colors = extractColorsFree(raw);
  if (colors.length) {
    hard.push(`color theme must visibly include these colors: ${colors.join(", ")}`);
    hard.push("apply the color theme to the gift boxes and accent elements (ribbons, tissue paper, small decor)");
    hard.push("keep the overall look premium and cohesive (do not look childish unless age indicates a child)");
  }

  const horrorKeywords = [
    "horror", "horror movie", "slasher", "gothic", "creepy", "haunted",
    "classic horror", "classic horror movie"
  ];
  const horrorMode = horrorKeywords.some(k => n.includes(k)) || n.includes("horror");

  if (horrorMode) {
    hard.push("classic horror movie aesthetic: moody cinematic lighting, retro film-grain feel, foggy ambience");
    hard.push("include ONE or TWO original, unbranded horror-style character elements as subtle decor — NOT recognizable IP");
    avoid.push("no recognizable copyrighted characters");
    avoid.push("no brand names or franchise logos");
    avoid.push("no gore or graphic violence");
  }

  if ((n.includes("surprise me") || n.includes("surprise")) && hard.length === 0 && age === null) {
    hard.push("choose a balanced, universally appealing mix of items appropriate for the occasion and recipient");
  }

  return { hard, avoid, age, raw, colors, horrorMode };
}

// -------------------- Option maps (from Code 1) --------------------
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

// -------------------- Brand lock (from Code 1) --------------------
const BRAND_RULES = [
  "premium modern gift aesthetic, clean and curated, not messy or chaotic",
  "studio/product photography: soft diffused lighting, realistic textures, high detail",
  "top-down or 3/4 angle composition that clearly shows contents",
  "cohesive color palette and premium materials (matte paper, satin ribbon, tissue paper)",
  "nested gift presentation feels intentional and emotionally thoughtful",
  "no visible brand logos on items; all packaging is generic/unbranded"
];

const BRAND_NEGATIVE = [
  "no text overlays",
  "no typography",
  "no labels or readable packaging text",
  "no watermarks",
  "no UI elements",
  "no empty boxes",
  "no closed lids",
  "no sealed packaging",
  "no boxes without visible contents"
];

// -------------------- Anything Else smart extraction (lite, from Code 2) --------------------
const CATEGORY_KEYWORDS = {
  toy: "include at least one age-appropriate toy item",
  toys: "include at least one age-appropriate toy item",
  shoes: "include at least one footwear-related item",
  sneaker: "include at least one footwear-related item",
  sneakers: "include at least one footwear-related item",
  jewelry: "include at least one refined jewelry/accessory item",
  gaming: "include at least one gaming-related accessory (controller/headset/accessory)",
  sports: "include at least one sports-related lifestyle item",
  books: "include at least one aesthetically pleasing book/notebook item",
  watch: "include at least one watch-like accessory item",
  watches: "include at least one watch-like accessory item",
  ring: "include at least one ring-like accessory item",
  rings: "include at least one ring-like accessory item",
  flowers: "include a floral element integrated tastefully (bouquet or floral item)",
  teddy: "include a teddy bear or plush element appropriate to the recipient",
  bear: "include a bear/plush element appropriate to the recipient",
};

function normalizeStr(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}
function toLower(s) {
  return normalizeStr(s).toLowerCase();
}
function extractCategories(anythingElse) {
  const text = toLower(anythingElse);
  const found = [];
  for (const k of Object.keys(CATEGORY_KEYWORDS)) {
    const re = new RegExp(`(^|\\W)${k}(\\W|$)`, "i");
    if (re.test(anythingElse) || text.includes(k)) found.push(k);
  }
  return Array.from(new Set(found));
}

// -------------------- Prompt builder (merged) --------------------
function buildPrompt({ inputs, tier = "Starter" }) {
  const notesRules = buildNotesRules(inputs.notes || "");
  const occasionRulesArr = OCCASION_MOTIFS[inputs.occasion] || ["items should clearly match the occasion"];
  const recipientRulesArr = RECIPIENT_MOTIFS[inputs.recipient] || ["items should clearly match the recipient type"];
  const vibeRulesArr = VIBE_STYLE[inputs.vibe] || ["styling should match the selected vibe"];

  const isSignature = String(tier || "").toLowerCase().includes("signature");
  const BOX_COUNT = isSignature ? 3 : 2;              // starter: 2 boxes; signature: 3 boxes
  const MIN_ITEMS_PER_BOX = isSignature ? 4 : 3;      // scale density

  const categories = extractCategories(inputs.notes || "");
  const categoryLines = categories.length
    ? categories.map((c) => `- Must include: ${CATEGORY_KEYWORDS[c]} (trigger: "${c}")`).join("\n")
    : "";

  const MUST_INCLUDE = [
    `show ${BOX_COUNT} open nested boxes (top, middle${BOX_COUNT === 3 ? ", bottom" : ""}), each box OPEN with lid removed or pushed aside`,
    `at least ${MIN_ITEMS_PER_BOX} distinct items clearly visible in EACH box (minimum total items visible: ${BOX_COUNT * MIN_ITEMS_PER_BOX})`,
    "items must be separated enough to count visually (not hidden under tissue paper)",
    "some items can peek out for depth, but keep a premium uncluttered layout",
    "avoid empty space that looks like missing items"
  ];

  if (inputs.occasion === "Baby shower") {
    MUST_INCLUDE.push("include at least TWO baby items clearly visible: onesie, baby bottle, pacifier, baby blanket, plush toy");
  }
  if (inputs.recipient === "My Pet") {
    MUST_INCLUDE.push("include pet items clearly visible: pet treats, toy, collar or accessory");
  }

  const NEGATIVE = [
    ...BRAND_NEGATIVE,
    "no logos",
    "no readable words on packaging",
    "no explicit content",
    "no alcohol",
    "no weapons",
    "no lingerie",
    "no cigarettes or drugs",
    "no gore",
    "no graphic violence",
    ...(notesRules.avoid || [])
  ];

  if (notesRules.horrorMode || inputs.occasion === "Halloween") {
    NEGATIVE.push("no recognizable copyrighted characters");
    NEGATIVE.push("no brand names or franchise logos");
    NEGATIVE.push("no gore or graphic violence");
  }

  const tierLine = isSignature
    ? "SIGNATURE TIER: fuller, deeper, more layered presentation, richer textures, slightly warmer cinematic shadows."
    : "STARTER TIER: cleaner, simpler arrangement, brighter minimal spacing, intentionally curated.";

  return `
High-end photorealistic studio product photography of a premium AI-curated nested gift box set with contents clearly visible.

Occasion: ${normalizeStr(inputs.occasion)}
Recipient: ${normalizeStr(inputs.recipient)}
Vibe: ${normalizeStr(inputs.vibe || "Surprise me")}
Tier: ${normalizeStr(tier)}

${tierLine}

BRAND / STYLE (Meaningfull™ look):
- ${BRAND_RULES.join("; ")}

HARD CONSTRAINTS:
- the gift boxes must be OPEN (lids removed or pushed aside)
- contents must be clearly visible at first glance
- ${MUST_INCLUDE.join("; ")}
- ${occasionRulesArr.join("; ")}
- ${recipientRulesArr.join("; ")}
- ${vibeRulesArr.join("; ")}
- ${notesRules.hard.length ? notesRules.hard.join("; ") : "use notes to meaningfully influence item selection when specific"}
- show items that obviously communicate the occasion (not subtle)

${categoryLines ? `CATEGORY ENFORCEMENT:\n${categoryLines}\n` : ""}

NEGATIVE CONSTRAINTS:
- ${NEGATIVE.join(", ")}

Notes (user text; treat as constraints when specific):
${notesRules.raw || "None"}

Social context (subtle influence only; no logos):
${normalizeStr(inputs.social || "None")}
`.trim();
}

// -------------------- OpenAI helpers (dynamic import so CommonJS file works) --------------------
async function getOpenAIClient() {
  const mod = await import("openai");
  const OpenAI = mod.default || mod;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function generateWithOpenAI({ prompt, size = "1024x1024", quality = "high", background = "transparent" }) {
  const openai = await getOpenAIClient();
  const img = await openai.images.generate({
    model: process.env.IMAGE_MODEL || "gpt-image-1",
    prompt,
    size,
    quality,
    background,
    n: 1,
  });
  const b64 = img?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return `data:image/png;base64,${b64}`;
}

async function validateWithVision({ imageDataUrl, mustReflect }) {
  if (!String(process.env.VALIDATE_WITH_VISION || "").toLowerCase() === "true") return { ok: true, reason: "disabled" };
  if (!normalizeStr(mustReflect)) return { ok: true, reason: "no_notes" };

  const openai = await getOpenAIClient();
  const prompt = `
You are a strict QA inspector for a generated product image preview.

User notes: "${normalizeStr(mustReflect)}"

Return ONLY JSON:
{ "ok": boolean, "missing": string[], "notes": string }

Rules:
- Be strict: if the image does not clearly reflect the notes, ok=false.
- If notes mention colors, confirm those colors dominate.
- If notes mention teddy/bear/flowers/toy/sneakers etc., confirm the item is visible.
- Do NOT require logos for brand-like mentions.
`.trim();

  const resp = await openai.responses.create({
    model: process.env.VISION_MODEL || "gpt-4.1-mini",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: imageDataUrl },
      ],
    }],
  });

  const text = resp.output_text || "";
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const sliced = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;
    return JSON.parse(sliced);
  } catch {
    return { ok: false, missing: ["validation_parse_error"], notes: text.slice(0, 300) };
  }
}

// -------------------- Main handler --------------------
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const inputs = body.inputs;
    const sessionId = body.sessionId;
    const tier = body.tier || inputs?.tier || "Starter";

    if (!inputs || !sessionId) {
      return res.status(400).json({ error: "Missing inputs or sessionId" });
    }

    const used = generationCount.get(sessionId) || 0;
    if (used >= MAX_GENERATIONS) {
      return res.status(429).json({ error: "Generation limit reached", used });
    }

    const prompt = buildPrompt({ inputs, tier });

    // Engine selection
    let imageUrl;
    if (PREVIEW_ENGINE === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "Missing OPENAI_API_KEY in Vercel env vars" });
      }

      // Try up to 2 times if vision validation is on
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const dataUrl = await generateWithOpenAI({
          prompt,
          size: body.size || "1024x1024",
          quality: body.quality || "high",
          background: body.background || "transparent",
        });

        if (String(process.env.VALIDATE_WITH_VISION || "").toLowerCase() === "true") {
          const verdict = await validateWithVision({ imageDataUrl: dataUrl, mustReflect: inputs.notes || "" });
          if (verdict?.ok) {
            imageUrl = dataUrl;
            break;
          }
          if (attempt === maxAttempts) {
            imageUrl = dataUrl; // return last attempt anyway
          }
        } else {
          imageUrl = dataUrl;
          break;
        }
      }
    } else {
      // replicate default
      if (!process.env.REPLICATE_API_TOKEN) {
        return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN in Vercel env vars" });
      }

      const output = await replicate.run(process.env.REPLICATE_MODEL || "black-forest-labs/flux-dev", {
        input: {
          prompt,
          aspect_ratio: "1:1",
          output_format: "webp",
          quality: 85,
        }
      });

      imageUrl = Array.isArray(output) ? output[0] : output;
    }

    generationCount.set(sessionId, used + 1);

    return res.status(200).json({
      ok: true,
      engine: PREVIEW_ENGINE,
      used: used + 1,
      imageUrl,
    });
  } catch (err) {
    console.error("generate-preview crashed:", err);
    return res.status(500).json({ ok: false, error: "Generation failed", details: String(err?.message || err) });
  }
};
