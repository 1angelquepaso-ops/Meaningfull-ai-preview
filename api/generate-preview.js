// /api/generate-preview.js
// Vercel Serverless Function (Node.js)
// Requires: npm i openai
//
// Uses OpenAI Image API (gpt-image-1) to generate a premium "editorial hero shot"
// and (optionally) runs a vision-based validation pass to ensure Anything Else was obeyed.
//
// Docs: Image generation guide + API reference :contentReference[oaicite:1]{index=1}

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------
// 1) Lightweight vocab lists
// ----------------------------

const BRAND_KEYWORDS = {
  nike: {
    label: "Nike-inspired athletic style",
    visual: "athletic footwear/apparel design language, performance textures, sporty accessories, black/white with optional neon accents",
    // Keep it "inspired", avoid logos by default
  },
  adidas: {
    label: "Adidas-inspired athletic style",
    visual: "streetwear athletic design language, performance fabrics, sporty accessories, black/white with muted accents",
  },
  apple: {
    label: "Apple-inspired minimalist tech style",
    visual: "minimal tech accessories, clean white/gray palette, refined packaging details",
  },
  lego: {
    label: "LEGO-style toy",
    visual: "brick-style building toy kit, clean playful geometry, premium presentation",
  },
  pokemon: {
    label: "collectible creature-themed toy",
    visual: "collectible card/toy vibe, playful shapes, premium display style",
  },
  "hot wheels": {
    label: "mini car toy",
    visual: "small collectible car toy, bold accent colors, premium layout",
  },
};

const CATEGORY_KEYWORDS = {
  toy: "at least one age-appropriate toy item",
  toys: "at least one age-appropriate toy item",
  shoes: "at least one footwear-related item",
  sneaker: "at least one footwear-related item",
  sneakers: "at least one footwear-related item",
  jewelry: "at least one refined jewelry/accessory item",
  gaming: "at least one gaming-related accessory (controller/headset/accessory)",
  sports: "at least one sports-related lifestyle item",
  books: "at least one aesthetically pleasing book/notebook item",
  watch: "at least one watch-like accessory item",
  watches: "at least one watch-like accessory item",
  ring: "at least one ring-like accessory item",
  rings: "at least one ring-like accessory item",
  flowers: "a floral element integrated tastefully (bouquet or floral item)",
  teddy: "a teddy bear or plush element appropriate to the recipient",
  bear: "a bear/plush element appropriate to the recipient",
};

const COLOR_KEYWORDS = [
  "blue",
  "navy",
  "light blue",
  "baby blue",
  "pink",
  "hot pink",
  "black",
  "white",
  "purple",
  "gold",
  "silver",
  "red",
  "green",
  "pastel",
  "neutral",
  "beige",
];

// ----------------------------
// 2) Helpers: normalize + extract
// ----------------------------

function normalizeStr(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function toLower(s) {
  return normalizeStr(s).toLowerCase();
}

function extractBrands(anythingElse) {
  const text = toLower(anythingElse);
  const found = [];

  // Handle multi-word keys first
  const multiKeys = Object.keys(BRAND_KEYWORDS).filter((k) => k.includes(" "));
  for (const k of multiKeys) {
    if (text.includes(k)) found.push(k);
  }

  // Single-word keys
  for (const k of Object.keys(BRAND_KEYWORDS)) {
    if (k.includes(" ")) continue;
    // word boundary-ish
    const re = new RegExp(`(^|\\W)${k}(\\W|$)`, "i");
    if (re.test(anythingElse)) found.push(k);
  }

  // Unique
  return Array.from(new Set(found));
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

function extractColors(anythingElse) {
  const text = toLower(anythingElse);
  const found = [];
  for (const c of COLOR_KEYWORDS) {
    if (text.includes(c)) found.push(c);
  }
  return Array.from(new Set(found));
}

function inferAgeFromNotes(ageRaw) {
  // If already numeric, keep it.
  const n = Number(ageRaw);
  if (Number.isFinite(n) && n > 0 && n < 120) return Math.round(n);

  // Try to parse patterns like "10 years old"
  const m = String(ageRaw || "").match(/(\d{1,2})\s*(years?\s*old|yo)\b/i);
  if (m) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) return v;
  }

  return null;
}

function ageBand(age) {
  if (!age || age < 0) return null;
  if (age <= 6) return "3–6";
  if (age <= 10) return "7–10";
  if (age <= 14) return "11–14";
  if (age <= 18) return "15–18";
  return "18+";
}

// ----------------------------
// 3) Prompt builder (the “money”)
// ----------------------------

function buildBasePrompt({
  recipient,
  occasion,
  vibe,
  tier,
  anythingElse,
  colors,
}) {
  // Tier rules: layers & density
  const isSignature = String(tier || "").toLowerCase().includes("signature");
  const layers = isSignature ? 3 : 2;
  const minItems = isSignature ? "5–6" : "4";

  // Color rule
  const colorLine =
    colors.length > 0
      ? `COLOR PALETTE (HARD OVERRIDE):
User specified colors: ${colors.join(", ")}.
These colors must dominate the palette (not small accents).`
      : `COLOR PALETTE:
Derived from recipient type, occasion, and vibe.`;

  return `
High-end editorial product photography of a premium AI-curated gift box.

STRUCTURE:
${layers}-tier nested rigid gift box design.
Top box partially open.
Middle layer clearly visible with curated items.
${layers === 3 ? "Bottom layer partially visible beneath." : "Second layer visible beneath the top."}

ITEM RULES:
Minimum ${minItems} visible items total.
Items must be touching or naturally layered.
No empty compartments.
No floating objects.

MATERIALS:
Luxury rigid cardboard.
Soft-touch matte finish.
Linen or premium paper textures.
Premium satin ribbon.

LIGHTING & CAMERA:
Soft studio lighting.
Natural shadows.
Shot on a 50mm lens.
f/1.8 shallow depth of field.
Foreground sharp, background softly blurred.

AESTHETIC:
Boutique, intentional, emotionally resonant.
Feels handcrafted and premium.
No clutter.
No randomness.

CONTEXT:
Recipient: ${normalizeStr(recipient) || "Unspecified"}
Occasion: ${normalizeStr(occasion) || "Unspecified"}
Vibe: ${normalizeStr(vibe) || "Unspecified"}

${colorLine}

IMPORTANT — USER PRIORITY OVERRIDE:
User-specified preferences must be visually represented.
Include items related to: ${normalizeStr(anythingElse) || "(none)"}
These items must be clearly visible and integrated naturally into the gift box.
Do not abstract or ignore these preferences.

CONSTRAINTS:
Do not include text.
Do not include UI elements.
Do not include logos unless explicitly allowed.
Do not include brand names as visible text.

STYLE:
Photorealistic.
Ultra-detailed.
Cinematic quality.
`.trim();
}

function buildBrandInjection(brands) {
  if (!brands.length) return "";

  const lines = brands.map((b) => {
    const meta = BRAND_KEYWORDS[b];
    return `- ${meta.label}: ${meta.visual}`;
  });

  return `
BRAND STYLE ENFORCEMENT (NO LOGOS BY DEFAULT):
The user mentioned brands. Represent the brand style through product category, materials, shapes, and color language.
Do NOT show logos or wordmarks.

Brands to reflect:
${lines.join("\n")}
`.trim();
}

function buildCategoryInjection(categories, age) {
  if (!categories.length) return "";

  const band = ageBand(age);
  const ageRule =
    band && (categories.includes("toy") || categories.includes("toys"))
      ? `Age-aware rule: recipient age is ${age} (band ${band}). Toy must be appropriate for this age band.`
      : "";

  const uniqueReqs = Array.from(
    new Set(
      categories.map((c) => `- Must include: ${CATEGORY_KEYWORDS[c]} (trigger: "${c}")`)
    )
  );

  return `
CATEGORY ENFORCEMENT:
${uniqueReqs.join("\n")}
${ageRule ? `\n${ageRule}` : ""}
`.trim();
}

function buildTierInjection(tier) {
  const t = String(tier || "").toLowerCase();
  if (t.includes("signature")) {
    return `
SIGNATURE TIER VISUAL DIFFERENTIATION:
Fuller, deeper, more layered presentation.
Richer lighting with slightly warmer cinematic shadows.
`.trim();
  }
  return `
STARTER TIER VISUAL DIFFERENTIATION:
Clean, simpler arrangement.
Bright, minimal, intentional spacing.
`.trim();
}

function buildFinalPrompt(payload) {
  const brands = extractBrands(payload.anythingElse);
  const categories = extractCategories(payload.anythingElse);
  const colors = extractColors(payload.anythingElse);

  const base = buildBasePrompt({ ...payload, colors });
  const brand = buildBrandInjection(brands);
  const cat = buildCategoryInjection(categories, payload.age);
  const tier = buildTierInjection(payload.tier);

  // Final
  return [base, brand, cat, tier].filter(Boolean).join("\n\n");
}

// ----------------------------
// 4) Optional vision validator (recommended)
// ----------------------------
// This uses the Images & Vision guide style: send image as input_image and ask model to verify.
// Docs: Images & vision guide :contentReference[oaicite:2]{index=2}
//
// Set env var VALIDATE_WITH_VISION="true" to enable (adds cost + a bit of latency).
// If enabled, we will regenerate once if validation fails.

async function validateWithVision({ imageDataUrl, anythingElse }) {
  // If no Anything Else, skip strict validation.
  if (!normalizeStr(anythingElse)) return { ok: true, reason: "no_anything_else" };

  const mustMention = normalizeStr(anythingElse);
  const prompt = `
You are a strict QA inspector for a generated product image preview.
The user wrote: "${mustMention}"

Task:
1) Decide if the image clearly reflects the user's request.
2) Return JSON with:
{
  "ok": boolean,
  "missing": string[],
  "notes": string
}

Rules:
- Be strict. If the request includes brands (e.g., Nike), confirm the image reflects the style/category clearly (do NOT require logos).
- If request includes "toy/toys", confirm a toy-like item is visible.
- If request includes colors (e.g., blue), confirm those colors dominate.
- If uncertain, set ok=false.
Return ONLY JSON.
`.trim();

  const resp = await openai.responses.create({
    model: process.env.VISION_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
  });

  // The Responses API returns structured output in output_text; we’ll parse best-effort.
  const text = resp.output_text || "";
  try {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    const sliced = jsonStart >= 0 && jsonEnd >= 0 ? text.slice(jsonStart, jsonEnd + 1) : text;
    const parsed = JSON.parse(sliced);
    return parsed;
  } catch {
    // If parsing fails, assume not OK (strict)
    return { ok: false, missing: ["validation_parse_error"], notes: text.slice(0, 300) };
  }
}

// ----------------------------
// 5) Main handler
// ----------------------------

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const {
      recipient = "",
      age = null,
      occasion = "",
      vibe = "",
      anythingElse = "",
      tier = "Starter",
      // image controls (optional)
      size = "1024x1024",
      quality = "high",
      background = "transparent",
    } = req.body || {};

    const parsedAge = inferAgeFromNotes(age);

    const payload = {
      recipient,
      age: parsedAge,
      occasion,
      vibe,
      anythingElse,
      tier,
    };

    const finalPrompt = buildFinalPrompt(payload);

    const maxAttempts = 2;
    let attempt = 0;
    let lastResult = null;

    while (attempt < maxAttempts) {
      attempt += 1;

      // Generate image with Image API
      // Docs: Images API reference :contentReference[oaicite:3]{index=3}
      const img = await openai.images.generate({
        model: process.env.IMAGE_MODEL || "gpt-image-1",
        prompt: finalPrompt,
        size,
        quality,
        background,
        n: 1,
      });

      // Most common return is base64 in b64_json (depending on settings/model)
      const b64 = img?.data?.[0]?.b64_json;
      if (!b64) {
        lastResult = { ok: false, reason: "no_image_data_returned" };
        continue;
      }

      const imageDataUrl = `data:image/png;base64,${b64}`;

      // Optional validation
      if (String(process.env.VALIDATE_WITH_VISION || "").toLowerCase() === "true") {
        const verdict = await validateWithVision({ imageDataUrl, anythingElse });
        if (!verdict?.ok) {
          lastResult = { ok: false, reason: "vision_validation_failed", verdict };
          continue; // regenerate
        }
      }

      // Success
      res.status(200).json({
        ok: true,
        attempt,
        imageDataUrl,
        meta: {
          tier,
          parsedAge,
          extracted: {
            brands: extractBrands(anythingElse),
            categories: extractCategories(anythingElse),
            colors: extractColors(anythingElse),
          },
        },
      });
      return;
    }

    // If we reached here, attempts exhausted
    res.status(200).json({
      ok: false,
      error: "Image generation failed validation after max attempts.",
      lastResult,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: "Server error generating preview.",
      details: String(err?.message || err),
    });
  }
}



