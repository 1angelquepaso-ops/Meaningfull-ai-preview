const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function clean(s, maxLen = 300) {
  if (!s) return "";
  return String(s).trim().slice(0, maxLen);
}

function buildPrompt({ variant, instagram, tiktok }) {
  const social = [
    instagram ? `Instagram: ${instagram}` : null,
    tiktok ? `TikTok: ${tiktok}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return [
    "Create a premium, photorealistic product preview image for an AI-curated gift box brand called Meaningfull™.",
    "The image should look like an elegant, modern gift box package preview on a clean studio background.",
    "Include: a tasteful gift box, tissue paper, subtle ribbon, and 3–6 small curated items partially visible (no brand logos).",
    "Style: minimal, premium, high-end ecommerce product photography, soft shadows, sharp focus.",
    "IMPORTANT: No text, no buttons, no UI, no watermarks, no logos.",
    variant ? `Tier/Variant context: ${variant}.` : "Tier/Variant context: not specified.",
    social
      ? `Optional style context provided by customer (do not browse or scrape): ${social}. Use only as inspiration for vibe/colors.`
      : "No social style context provided.",
    "Output: one square image, centered composition.",
  ].join("\n");
}

/**
 * Demo placeholder image (SVG) as a data URL.
 * - Looks clean in Shopify preview
 * - No hosting needed
 */
function demoImageDataUrl({ variant }) {
  const title = variant ? `Preview • ${variant}` : "Preview";
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
    <text x="512" y="170" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#111111" opacity=".92">${escapeXml(title)}</text>
    <text x="512" y="220" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#444" opacity=".78">Demo preview (billing not connected yet)</text>
  </svg>`.trim();

  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const body = req.body || {};
  const variant = clean(body.variant, 200);
  const instagram = clean(body.instagram, 200);
  const tiktok = clean(body.tiktok, 200);

  // ✅ DEMO MODE: return placeholder preview immediately
  const demoMode = String(process.env.DEMO_MODE || "").toLowerCase() === "true";
  if (demoMode) {
    return res.status(200).json({
      imageUrl: demoImageDataUrl({ variant }),
      demo: true,
    });
  }

  try {
    const prompt = buildPrompt({ variant, instagram, tiktok });
    const model = process.env.IMAGE_MODEL || "gpt-image-1";

    const result = await client.images.generate({
      model,
      prompt,
      size: "1024x1024",
    });

    const first = result?.data?.[0];
    const imageUrl =
      first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : null);

    if (!imageUrl) {
      // fallback to demo image so Shopify flow never breaks
      return res.status(200).json({
        imageUrl: demoImageDataUrl({ variant }),
        demo: true,
        note: "No image returned; using demo placeholder.",
      });
    }

    return res.status(200).json({ imageUrl, demo: false });
  } catch (err) {
    // ✅ Billing errors (or any OpenAI errors) fall back to demo image so you can keep building
    return res.status(200).json({
      imageUrl: demoImageDataUrl({ variant }),
      demo: true,
      note: err?.message || "OpenAI failed; using demo placeholder.",
    });
  }
};

