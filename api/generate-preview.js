/**
 * Meaningfull™ AI Preview Generator (MVP)
 * Provider-agnostic endpoint:
 * - DEMO_MODE=true => returns placeholder image (always safe)
 * - AI_PROVIDER=replicate => uses Replicate (flux-dev)
 * - AI_PROVIDER=openai => optional OpenAI path (if billing works later)
 *
 * Inputs (JSON body):
 *   { variant, instagram, tiktok, productId }
 *
 * Output (JSON):
 *   { imageUrl, demo, provider, note? }
 */

const OpenAI = require("openai"); // optional; keep for later
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function clean(s, maxLen = 300) {
  if (!s) return "";
  return String(s).trim().slice(0, maxLen);
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Customer-safe placeholder preview (SVG) as data URL.
 * This is used when DEMO_MODE=true or if provider errors.
 */
function demoImageDataUrl({ variant }) {
  const title = variant ? `Preview • ${variant}` : "Preview";
  const subtitle = "AI-generated visual preview";

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#f5f5f7"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity=".12"/>
      </filter>
    </defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <g filter="url(#shadow)">
      <rect x="212" y="320" rx="36" ry="36" width="600" height="420" fill="#ffffff" stroke="#e6e6e9" stroke-width="4"/>
      <rect x="212" y="290" rx="36" ry="36" width="600" height="140" fill="#fbfbfc" stroke="#e6e6e9" stroke-width="4"/>
      <path d="M512 292 C512 292 430 320 430 390 C430 460 512 430 512 430 C512 430 594 460 594 390 C594 320 512 292 512 292 Z"
            fill="#f0f0f3" stroke="#e1e1e6" stroke-width="4"/>
      <rect x="495" y="290" width="34" height="450" fill="#f0f0f3" stroke="#e1e1e6" stroke-width="3"/>
      <circle cx="380" cy="620" r="44" fill="#f2f2f5" stroke="#e1e1e6" stroke-width="4"/>
      <rect x="560" y="580" rx="18" ry="18" width="170" height="120" fill="#f2f2f5" stroke="#e1e1e6" stroke-width="4"/>
      <rect x="330" y="520" rx="18" ry="18" width="140" height="90" fill="#f2f2f5" stroke="#e1e1e6" stroke-width="4"/>
    </g>
    <text x="512" y="170" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-size="44" fill="#111111" opacity=".92">${escapeXml(title)}</text>
    <text x="512" y="220" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-size="22" fill="#444" opacity=".78">${escapeXml(subtitle)}</text>
  </svg>`.trim();

  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Prompt builder (shared across providers)
 */
function buildPrompt({ variant, instagram, tiktok }) {
  const social = [
    instagram ? `Instagram: ${instagram}` : null,
    tiktok ? `TikTok: ${tiktok}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return [
    "Create a premium, photorealistic ecommerce product image for an AI-curated gift box brand called Meaningfull™.",
    "Scene: elegant modern gift box on a clean studio background, centered composition.",
    "Include: gift box, tissue paper, subtle ribbon, and 3–6 small curated items partially visible (no brand logos).",
    "Style: minimal, premium, high-end product photography, soft shadows, sharp focus.",
    "IMPORTANT: No text, no buttons, no UI, no watermarks, no logos.",
    variant ? `Tier/Variant context: ${variant}.` : "Tier/Variant context: not specified.",
    social
      ? `Optional style context provided by customer (do not browse or scrape): ${social}. Use only as inspiration for vibe/colors.`
      : "No social style context provided.",
    "Output: one square image, 1:1 aspect ratio.",
  ].join("\n");
}

/**
 * Replicate runner using FLUX Dev
 * - create prediction
 * - poll until succeeded
 */
async function generateWithReplicate({ prompt }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("Missing REPLICATE_API_TOKEN");

  const createUrl =
    "https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions";

  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      input: {
        prompt,
        aspect_ratio: "1:1",
        num_outputs: 1,
      },
    }),
  });

  const created = await createRes.json();
  if (!createRes.ok) {
    throw new Error(created?.detail || created?.error || "Replicate create failed");
  }

  const getUrl = created?.urls?.get;
  if (!getUrl) throw new Error("Replicate response missing urls.get");

  // Poll ~20 seconds max
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 800));

    const pollRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pred = await pollRes.json();

    if (pred?.status === "succeeded") {
      const out = pred?.output;
      const url = Array.isArray(out) ? out[0] : out;
      if (!url) throw new Error("Replicate succeeded but no output URL");
      return url;
    }

    if (pred?.status === "failed" || pred?.status === "canceled") {
      throw new Error(pred?.error || `Replicate ${pred.status}`);
    }
  }

  throw new Error("Replicate timed out");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const body = req.body || {};
  const variant = clean(body.variant, 200);
  const instagram = clean(body.instagram, 200);
  const tiktok = clean(body.tiktok, 200);

  const demoMode = String(process.env.DEMO_MODE || "").toLowerCase() === "true";
  const provider = String(process.env.AI_PROVIDER || "replicate").toLowerCase();

  // ✅ Always-safe mode
  if (demoMode) {
    return res.status(200).json({
      imageUrl: demoImageDataUrl({ variant }),
      demo: true,
      provider: "demo",
    });
  }

  const prompt = buildPrompt({ variant, instagram, tiktok });

  try {
    // ✅ Replicate (recommended)
    if (provider === "replicate") {
      const imageUrl = await generateWithReplicate({ prompt });
      return res.status(200).json({
        imageUrl,
        demo: false,
        provider: "replicate",
      });
    }

    // Optional: OpenAI (if you fix billing later)
    if (provider === "openai") {
      const model = process.env.IMAGE_MODEL || "gpt-image-1";
      const result = await openaiClient.images.generate({
        model,
        prompt,
        size: "1024x1024",
      });

      const first = result?.data?.[0];
      const imageUrl =
        first?.url ||
        (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : null);

      if (!imageUrl) throw new Error("No image returned from OpenAI");

      return res.status(200).json({
        imageUrl,
        demo: false,
        provider: "openai",
      });
    }

    // Unknown provider => fallback
    throw new Error(`Unknown AI_PROVIDER: ${provider}`);
  } catch (err) {
    // ✅ Never break Shopify UX — fallback placeholder
    return res.status(200).json({
      imageUrl: demoImageDataUrl({ variant }),
      demo: true,
      provider: "fallback",
      note: err?.message || "Provider failed; using placeholder.",
    });
  }
};
