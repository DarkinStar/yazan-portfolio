import { useState, useRef, useEffect } from "react";
import { content } from "./content";
import { CHAT_URL } from "./config";

// --- Lightweight markdown renderer (bold, newlines only) ---
function MarkdownText({ text }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, li) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <span key={li}>
            {parts.map((part, pi) => {
              if (part.startsWith("**") && part.endsWith("**")) {
                return <strong key={pi}>{part.slice(2, -2)}</strong>;
              }
              return <span key={pi}>{part}</span>;
            })}
            {li < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState([]);

  const loading = chatLoading;
  const hasContent = messages.length > 0;
  const showWindow = active && (hasContent || loading);

  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const sessionId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const initials = content.name
    .split(" ")
    .map((w) => w[0])
    .join("");

  // --- Submit ---
  const onSubmit = async () => {
    const q = query.trim();
    if (!q || chatLoading) return;

    setActive(true);
    const nextMessages = [...messages, { role: "user", text: q }];
    setMessages(nextMessages);
    setQuery("");
    setChatLoading(true);

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": sessionId.current,
        },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: data.error || "Что-то пошло не так. Попробуйте ещё раз." },
        ]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Ошибка сети — проверьте подключение и попробуйте снова." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const closeWindow = () => {
    setActive(false);
    setChatLoading(false);
    setMessages([]);
    setQuery("");
  };

  // Ask a suggested question from the fit-block CTA: fill input, scroll up, focus.
  const askExample = (ex) => {
    setQuery(ex);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <div className={`page ${active ? "is-active" : ""}`}>
      <div className="wrap">
        <header className={`hero ${active ? "hero--compact" : ""}`}>
          <div className="hero-head">
            <div className="avatar" aria-label="Фото">
              {content.headshot ? (
                <img src={content.headshot} alt={content.name} />
              ) : (
                <span>
                  {initials}
                  <br />
                  фото
                </span>
              )}
            </div>
            <div className="hero-id">
              <h1 className="hero-name">{content.name}</h1>
              <p className="hero-value">{content.valueLine}</p>
            </div>
          </div>

          <p className="hero-pitch">{content.pitch}</p>
          <div className="retrieval-line" aria-hidden="true">
            <span className="rl-q">"vague idea…"</span>
            <span className="rl-track" />
            <span className="rl-hit">ranked result</span>
          </div>
        </header>

        <section className="demo" aria-label="Чат-ассистент">
          <div className="demo-bar">
            <div className="demo-title">{content.chat.title}</div>
            {active && (
              <button
                className="close-btn"
                onClick={closeWindow}
                aria-label="Закрыть и вернуться"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>

          {showWindow && (
            <div className="window" role="region" aria-live="polite">
              <div className="thread" ref={threadRef}>
                {messages.map((m, i) => (
                  <div key={i} className={`bubble bubble--${m.role}`}>
                    <MarkdownText text={m.text} />
                  </div>
                ))}
                {loading && (
                  <div className="bubble bubble--assistant bubble--typing">
                    <span></span><span></span><span></span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="field">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={content.chat.placeholder}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              aria-label="Задать вопрос"
            />
            <button onClick={onSubmit} disabled={loading}>
              Спросить
            </button>
          </div>

          {!hasContent && !loading && (
            <>
              <p className="hint">{content.chat.emptyHint}</p>
              <div className="examples">
                {content.chat.examples.map((ex) => (
                  <button
                    key={ex}
                    className="chip"
                    onClick={() => setQuery(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ---------- "Почему я подхожу" блок ---------- */}
        <section className="fit" aria-label="Почему я подхожу">
          {/* 1. О проекте */}
          <div className="fit-block">
            <h2 className="fit-h">{content.fit.projectTitle}</h2>
            <p className="fit-body">{content.fit.projectBody}</p>
          </div>

          {/* 2. Технологии */}
          <div className="fit-block">
            <h2 className="fit-h">{content.fit.techTitle}</h2>
            <div className="tech-groups">
              {content.fit.techGroups.map((g) => (
                <div key={g.label} className="tech-group">
                  <div className="tech-label">{g.label}</div>
                  <div className="tech-items">
                    {g.items.map((it) => (
                      <span key={it} className="tech-tag">{it}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="fit-note">{content.fit.techNote}</p>
          </div>

          {/* 3. Таблица соответствия */}
          <div className="fit-block">
            <h2 className="fit-h">{content.fit.mapTitle}</h2>
            <div className="map-table">
              {content.fit.mapRows.map((row, i) => (
                <div key={i} className="map-row">
                  <div className="map-need">{row.need}</div>
                  <div className="map-has">{row.has}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Доменный опыт */}
          <div className="fit-block">
            <h2 className="fit-h">{content.fit.domainTitle}</h2>
            <p className="fit-body">{content.fit.domainBody}</p>
          </div>

          {/* 5. Призыв к чату */}
          <div className="fit-cta">
            <h2 className="fit-h">{content.fit.ctaTitle}</h2>
            <p className="fit-body">{content.fit.ctaBody}</p>
            <div className="examples">
              {content.fit.ctaExamples.map((ex) => (
                <button
                  key={ex}
                  className="chip"
                  onClick={() => askExample(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <footer className="foot">
        <div className="foot-inner">
          <a href={`mailto:${content.contact.email}`} aria-label="Email" title={content.contact.email}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
              <path d="M3 6l9 7 9-7" />
            </svg>
          </a>
          <a href={`https://t.me/${content.contact.telegram}`} target="_blank" rel="noreferrer" aria-label="Telegram" title={`@${content.contact.telegram}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M21.5 4.3L2.9 11.4c-.9.36-.9.87-.17 1.1l4.76 1.48 1.84 5.6c.22.6.4.83.83.83.42 0 .6-.2.82-.53l2.3-2.24 4.78 3.53c.88.48 1.5.23 1.72-.81l3.1-14.6c.32-1.27-.5-1.85-1.18-1.62z" />
            </svg>
          </a>
          <a href={`https://github.com/${content.contact.github}`} target="_blank" rel="noreferrer" aria-label="GitHub" title={`github.com/${content.contact.github}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.36 9.36 0 0112 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.02 10.02 0 0022 12.25C22 6.58 17.52 2 12 2z" />
            </svg>
          </a>
        </div>
      </footer>
    </div>
  );
}
