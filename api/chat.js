// api/chat.js  —  Vercel serverless function
// Features: guardrails, rate limiting, lead capture via Resend, markdown-safe replies.

// --- Input guardrails ---
const BLOCK_PATTERNS = [
  /i'?m\s+(yazan|the\s+developer|the\s+owner|testing|a\s+tester)/i,
  /this\s+is\s+yazan/i,
  /i\s+built\s+this/i,
  /i\s+am\s+testing/i,
  /ignore\s+(previous|prior|above|all)\s+instructions/i,
  /forget\s+(your|the)\s+(instructions|rules|prompt)/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+(a\s+)?(general|different|new)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /your\s+new\s+(role|purpose|job|instructions)/i,
  /disregard\s+.{0,30}instructions/i,
  /write\s+(me\s+)?(a\s+)?(code|script|function|class|program)/i,
  /fix\s+(this|my|the)\s+(code|bug|error|issue)/i,
  /debug\s+(this|my)/i,
  /how\s+do\s+i\s+(code|implement|build|create|make)\s/i,
  /give\s+me\s+(a\s+)?(code|script|solution|example)/i,
  /show\s+me\s+(how\s+to\s+code|an?\s+example\s+of\s+code)/i,
];

function isBlocked(text) {
  return BLOCK_PATTERNS.some((p) => p.test(text));
}

// --- Interest keywords that trigger handoff offer ---
const INTEREST_PATTERNS = [
  /\b(interested|impressive|hire|hiring)\b/i,
  /\b(want to (talk|meet|chat|connect|interview))\b/i,
  /\b(reach out|get in touch|contact (him|yazan))\b/i,
  /\b(how (do I|can I|to) (contact|reach|get in touch))\b/i,
  /\b(sounds? good|looks? good|great (profile|candidate|fit))\b/i,
  /\b(would like to (talk|meet|discuss|interview))\b/i,
  /\b(let('?s| us) (talk|meet|connect|chat))\b/i,
  // Notification / message / email requests
  /\b(send|forward|pass).{0,20}(him|yazan).{0,20}(message|email|notification|note)\b/i,
  /\b(notify|notification|alert)\b/i,
  /\b(can you (tell|inform|message|email|contact) (him|yazan))\b/i,
  /\b(i('?d| would) like (to (speak|talk|chat|connect)|him to (call|contact|reach))\b)/i,
  /\b(pass (this|my|the) (info|details|contact|message) (to|along))\b/i,
  /\b(how (do|can) (i|we) (get|be) in touch)\b/i,
  /\b(connect (me|us) with (him|yazan))\b/i,
];

function showsInterest(text) {
  return INTEREST_PATTERNS.some((p) => p.test(text));
}

// --- Check if the conversation is in "collecting contact info" state ---
// We look for the handoff offer in the last assistant message
const HANDOFF_OFFER_MARKER = "___HANDOFF_OFFERED___";

function wasHandoffOffered(messages) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return lastAssistant?.text?.includes(HANDOFF_OFFER_MARKER);
}

// --- Send email via Resend ---
async function sendLeadEmail(contactInfo) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not set");
    return false;
  }

  const body = {
    from: "Portfolio Assistant <onboarding@resend.dev>",
    to: ["yazanalnajm19@gmail.com"],
    subject: "New recruiter inquiry from your portfolio",
    html: `
      <h2>Someone is interested!</h2>
      <p>A recruiter left their details via your portfolio chat:</p>
      <hr/>
      <p><strong>Message:</strong></p>
      <blockquote style="border-left:3px solid #4f46e5;padding-left:12px;color:#333;">
        ${contactInfo.replace(/\n/g, "<br/>")}
      </blockquote>
      <hr/>
      <p style="color:#888;font-size:12px;">Sent automatically from yazan-portfolio-bice.vercel.app</p>
    `,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error("Resend error:", err);
    return false;
  }
}

// --- Rate limiting ---
const rateLimitMap = new Map();
const MAX_TURNS = 10;
const WINDOW_MS = 60 * 60 * 1000;
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

// Track which sessions have already been offered the handoff (proactive turn trigger)
const proactiveHandoffSessions = new Set();

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || "";
  const allowedOrigins = [
    "https://yazan-portfolio-bice.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
  ];
  if (allowedOrigins.includes(origin)) {
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

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUserMsg?.text || "";

  // --- Guardrail check ---
  if (isBlocked(lastUserText)) {
    return res.status(200).json({
      reply:
        "I'm here to answer questions about Yazan's background and experience for recruiters and hiring managers. I can't help with that — is there something about his skills or projects you'd like to know?",
    });
  }

  // --- Lead capture: was handoff offered and recruiter just replied with their info? ---
  if (wasHandoffOffered(messages) && lastUserText.length > 10) {
    const sent = await sendLeadEmail(lastUserText);
    const reply = sent
      ? "Done — Yazan has your details and will be in touch soon. You can also reach him directly at yazanalnajm19@gmail.com or @darkinstar on Telegram."
      : "I had trouble sending that — please reach out to Yazan directly at yazanalnajm19@gmail.com or @darkinstar on Telegram.";
    return res.status(200).json({ reply });
  }

  // --- Keyword trigger: recruiter shows interest ---
  if (showsInterest(lastUserText)) {
    const handoffOffer =
      "Glad to hear it! If you'd like Yazan to reach out, just share your **name**, **email**, and a short **note** — I'll pass it along to him directly. " +
      HANDOFF_OFFER_MARKER;
    return res.status(200).json({ reply: handoffOffer });
  }

  // --- Proactive turn trigger: offer handoff after 5 user messages ---
  const userTurnCount = messages.filter((m) => m.role === "user").length;
  const alreadyOffered = proactiveHandoffSessions.has(sessionId);

  if (userTurnCount >= 5 && !alreadyOffered) {
    proactiveHandoffSessions.add(sessionId);
    // Let Claude answer normally, then append the handoff nudge
    // We handle this by injecting into the system prompt below
  }

  // Load system prompt + knowledge from env vars
  const systemPrompt = process.env.PORTFOLIO_SYSTEM_PROMPT;
  const knowledge = process.env.PORTFOLIO_KNOWLEDGE;

  if (!systemPrompt || !knowledge) {
    console.error("Missing PORTFOLIO_SYSTEM_PROMPT or PORTFOLIO_KNOWLEDGE env var");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Append proactive nudge instruction if triggered
  const proactiveInstruction =
    userTurnCount >= 5 && !alreadyOffered
      ? `\n\n# Proactive handoff\nAt the END of your next response, add a natural one-sentence nudge: let the recruiter know that if they'd like Yazan to reach out, they can share their name, email, and a note and you'll pass it along. Keep it brief and non-pushy. Append the exact text " ${HANDOFF_OFFER_MARKER}" (with a space before it) at the very end of your reply so the system can track this.`
      : "";

  const fullSystem = `${systemPrompt}\n\n---\n\n${knowledge}${proactiveInstruction}`;

  // Map to Anthropic format — strip the marker from assistant messages before sending
  const apiMessages = messages
    .filter((m) => m.role && m.text)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.text).replace(HANDOFF_OFFER_MARKER, "").slice(0, 2000),
    }));

  if (apiMessages.length === 0) {
    return res.status(400).json({ error: "No valid messages" });
  }

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
    let reply =
      data?.content?.find((b) => b.type === "text")?.text ||
      "Sorry, I couldn't generate a response.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}