// api/chat.js  —  Vercel serverless function
// Receives chat messages from the frontend, calls Claude, returns reply.
// System prompt and knowledge are loaded from env vars — never hardcoded.

// --- Rate limiting (in-memory, resets on cold start) ---
const rateLimitMap = new Map(); // sessionId -> { count, windowStart }
const MAX_TURNS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_SESSIONS_PER_WINDOW = 5;
const ipMap = new Map();

function checkRateLimit(sessionId, ip) {
  const now = Date.now();

  if (sessionId) {
    const sess = rateLimitMap.get(sessionId) || { count: 0, windowStart: now };
    if (now - sess.windowStart > WINDOW_MS) {
      sess.count = 0;
      sess.windowStart = now;
    }
    if (sess.count >= MAX_TURNS) {
      return { allowed: false, reason: "turn_cap" };
    }
    sess.count += 1;
    rateLimitMap.set(sessionId, sess);
  }

  if (ip) {
    const ipEntry = ipMap.get(ip) || { count: 0, windowStart: now };
    if (now - ipEntry.windowStart > WINDOW_MS) {
      ipEntry.count = 0;
      ipEntry.windowStart = now;
    }
    if (ipEntry.count >= MAX_SESSIONS_PER_WINDOW) {
      return { allowed: false, reason: "ip_limit" };
    }
    if (sessionId && rateLimitMap.get(sessionId)?.count === 1) {
      ipEntry.count += 1;
    }
    ipMap.set(ip, ipEntry);
  }

  return { allowed: true };
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || "";
  const allowed = [
    "https://yazan-portfolio-bice.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
  ];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Session-Id");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limiting
  const sessionId = req.headers["x-session-id"] || null;
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    null;

  const { allowed: ok, reason } = checkRateLimit(sessionId, ip);
  if (!ok) {
    const msg =
      reason === "turn_cap"
        ? "You've reached the message limit for this session. To continue the conversation, please contact Yazan directly at yazanalnajm19@gmail.com or @darkinstar on Telegram."
        : "Too many requests. Please try again later.";
    return res.status(429).json({ error: msg });
  }

  // Load system prompt + knowledge from env vars
  const systemPrompt = process.env.PORTFOLIO_SYSTEM_PROMPT;
  const knowledge = process.env.PORTFOLIO_KNOWLEDGE;

  if (!systemPrompt || !knowledge) {
    console.error("Missing PORTFOLIO_SYSTEM_PROMPT or PORTFOLIO_KNOWLEDGE env var");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const fullSystem = `${systemPrompt}\n\n---\n\n${knowledge}`;

  // Parse body
  let messages;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array required" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // Map to Anthropic format
  const apiMessages = messages
    .filter((m) => m.role && m.text)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.text).slice(0, 2000),
    }));

  if (apiMessages.length === 0) {
    return res.status(400).json({ error: "No valid messages" });
  }

  // Call Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    return res.status(500).json({ error: "Server configuration error" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        system: fullSystem,
        messages: apiMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return res.status(502).json({ error: "AI service error. Please try again." });
    }

    const data = await response.json();
    const reply =
      data?.content?.find((b) => b.type === "text")?.text ||
      "Sorry, I couldn't generate a response.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
