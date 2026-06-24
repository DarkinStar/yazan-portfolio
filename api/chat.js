// api/chat.js  —  Vercel serverless function
// Features: guardrails (RU+EN), rate limiting, lead capture via Resend, markdown-safe replies.

// --- Input guardrails (Russian + English) ---
const BLOCK_PATTERNS = [
  // Identity claims — EN
  /i'?m\s+(yazan|the\s+developer|the\s+owner|testing|a\s+tester)/i,
  /this\s+is\s+yazan/i,
  /i\s+built\s+this/i,
  /i\s+am\s+testing/i,
  // Identity claims — RU
  /я\s+язан/i,
  /это\s+язан/i,
  /я\s+(разработчик|владелец|создатель)\s+(этого\s+)?(сайта|бота|ассистента)/i,
  /я\s+(тестирую|проверяю|это\s+тест)/i,
  /я\s+(сделал|создал|построил)\s+(этот\s+)?(сайт|бот|ассистент)/i,
  // Instruction override — EN
  /ignore\s+(previous|prior|above|all)\s+instructions/i,
  /forget\s+(your|the)\s+(instructions|rules|prompt)/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+(a\s+)?(general|different|new)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /your\s+new\s+(role|purpose|job|instructions)/i,
  /disregard\s+.{0,30}instructions/i,
  // Instruction override — RU
  /игнорируй\s+(все\s+)?(предыдущие|прошлые|вышесказанные)?\s*(инструкции|правила|промпт)/i,
  /забудь\s+(свои|все)?\s*(инструкции|правила|промпт)/i,
  /(теперь\s+)?ты\s+(теперь\s+)?(обычный|другой|новый)\s+(ассистент|помощник|бот)/i,
  /представь(,)?\s+что\s+ты/i,
  /притворись(,)?\s+что/i,
  /веди\s+себя\s+как\s+(обычный|другой)/i,
  /твоя\s+новая\s+(роль|задача|инструкция|цель)/i,
  // Code / general assistant — EN
  /write\s+(me\s+)?(a\s+)?(code|script|function|class|program)/i,
  /fix\s+(this|my|the)\s+(code|bug|error|issue)/i,
  /debug\s+(this|my)/i,
  /how\s+do\s+i\s+(code|implement|build|create|make)\s/i,
  /give\s+me\s+(a\s+)?(code|script|solution|example)/i,
  /show\s+me\s+(how\s+to\s+code|an?\s+example\s+of\s+code)/i,
  // Code / general assistant — RU
  /напиши\s+(мне\s+)?(код|скрипт|функцию|класс|программу)/i,
  /исправь\s+(этот\s+)?(код|баг|ошибку)/i,
  /(по)?чини\s+(этот\s+)?код/i,
  /как\s+(мне\s+)?(написать\s+код|реализовать|запрограммировать)/i,
  /дай\s+(мне\s+)?(код|скрипт|решение|пример\s+кода)/i,
  /реши\s+(эту\s+)?(задачу|проблему)\s+(по\s+)?(коду|программированию)/i,
];

function isBlocked(text) {
  return BLOCK_PATTERNS.some((p) => p.test(text));
}

// --- Interest keywords that trigger handoff offer (Russian + English) ---
const INTEREST_PATTERNS = [
  // EN
  /\b(interested|impressive|hire|hiring)\b/i,
  /\b(want to (talk|meet|chat|connect|interview))\b/i,
  /\b(reach out|get in touch|contact (him|yazan))\b/i,
  /\b(how (do I|can I|to) (contact|reach|get in touch))\b/i,
  /\b(send|forward|pass).{0,20}(him|yazan).{0,20}(message|email|notification|note)\b/i,
  /\b(notify|notification)\b/i,
  /\b(connect (me|us) with (him|yazan))\b/i,
  // RU — interest
  /\b(интересн|впечатл|хотим\s+нанять|готовы\s+нанять)/i,
  /\b(хочу|хотим|хотел(а|и)?\s+бы|хотелось\s+бы)\s+(пообщаться|поговорить|связаться|встретиться|обсудить|на\s+собеседование)/i,
  /\b(как\s+(с\s+ним\s+)?(связаться|написать|выйти\s+на\s+связь))/i,
  /\b(можно\s+(ли\s+)?(с\s+ним\s+)?(связаться|пообщаться|поговорить))/i,
  // RU — send / notify him
  /\b(переда(й|йте|ть)|сообщи(те)?|напиши(те)?|отправь(те)?)\s+(ему|язану)/i,
  /\b(уведом(и|ите|ить)|оповест(и|ите))\s+(его|язана)?/i,
  /\b(свяжите\s+(меня|нас)\s+с\s+(ним|язаном))/i,
  /\b(пусть\s+(он\s+)?(напишет|свяжется|позвонит))/i,
  /\b(передать\s+(ему\s+)?(контакт|сообщение|информацию))/i,
  // RU — positive signals
  /\b(отличн(ый|ая)\s+(профиль|кандидат|опыт)|хорошо\s+подходит|подходящий\s+кандидат)/i,
];

function showsInterest(text) {
  return INTEREST_PATTERNS.some((p) => p.test(text));
}

// --- Handoff state marker ---
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
    subject: "Новый отклик с портфолио",
    html: `
      <h2>Кто-то заинтересовался!</h2>
      <p>Рекрутер оставил свои контакты через чат на портфолио:</p>
      <hr/>
      <p><strong>Сообщение:</strong></p>
      <blockquote style="border-left:3px solid #4f46e5;padding-left:12px;color:#333;">
        ${contactInfo.replace(/\n/g, "<br/>")}
      </blockquote>
      <hr/>
      <p style="color:#888;font-size:12px;">Отправлено автоматически с yazan-portfolio-bice.vercel.app</p>
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
        ? "Вы достигли лимита сообщений в этой сессии. Чтобы продолжить общение, свяжитесь с Язаном напрямую: yazanalnajm19@gmail.com или @darkinstar в Telegram."
        : "Слишком много запросов. Пожалуйста, попробуйте позже.";
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
        "Я отвечаю на вопросы об опыте и навыках Язана — для рекрутеров и нанимающих менеджеров. С этим помочь не могу. Хотите узнать что-то о его проектах или опыте?",
    });
  }

  // --- Lead capture: handoff was offered and recruiter replied with info ---
  if (wasHandoffOffered(messages) && lastUserText.length > 10) {
    const sent = await sendLeadEmail(lastUserText);
    const reply = sent
      ? "Готово — Язан получил ваши данные и скоро свяжется с вами. Также можете написать ему напрямую: yazanalnajm19@gmail.com или @darkinstar в Telegram."
      : "Не удалось отправить — пожалуйста, свяжитесь с Язаном напрямую: yazanalnajm19@gmail.com или @darkinstar в Telegram.";
    return res.status(200).json({ reply });
  }

  // --- Keyword trigger: recruiter shows interest ---
  if (showsInterest(lastUserText)) {
    const handoffOffer =
      "Рад это слышать! Если хотите, чтобы Язан с вами связался, оставьте, пожалуйста, **имя**, **email** и короткое **сообщение** — я передам ему напрямую. " +
      HANDOFF_OFFER_MARKER;
    return res.status(200).json({ reply: handoffOffer });
  }

  // --- Proactive turn trigger ---
  const userTurnCount = messages.filter((m) => m.role === "user").length;
  const alreadyOffered = proactiveHandoffSessions.has(sessionId);

  if (userTurnCount >= 5 && !alreadyOffered) {
    proactiveHandoffSessions.add(sessionId);
  }

  // Load system prompt + knowledge
  const systemPrompt = process.env.PORTFOLIO_SYSTEM_PROMPT;
  const knowledge = process.env.PORTFOLIO_KNOWLEDGE;

  if (!systemPrompt || !knowledge) {
    console.error("Missing PORTFOLIO_SYSTEM_PROMPT or PORTFOLIO_KNOWLEDGE env var");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const proactiveInstruction =
    userTurnCount >= 5 && !alreadyOffered
      ? `\n\n# Проактивный handoff\nВ КОНЦЕ своего следующего ответа добавь короткую естественную фразу: если рекрутер хочет, чтобы Язан с ним связался, он может оставить имя, email и сообщение, и ты передашь это напрямую. Кратко и ненавязчиво. В самом конце ответа добавь точный текст " ${HANDOFF_OFFER_MARKER}" (с пробелом перед ним), чтобы система могла это отследить.`
      : "";

  const fullSystem = `${systemPrompt}\n\n---\n\n${knowledge}${proactiveInstruction}`;

  // Map to Anthropic format — strip marker from assistant messages
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
      return res.status(502).json({ error: "Ошибка AI-сервиса. Попробуйте ещё раз." });
    }

    const data = await response.json();
    const reply =
      data?.content?.find((b) => b.type === "text")?.text ||
      "Извините, не удалось сформировать ответ.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}