// Single source of truth for backend endpoints.
// Stubbed now; filled in when chat (Step 4) and search (Steps 5-8) exist.
// In production these come from Vercel env vars (VITE_ prefix = exposed to frontend).
export const CHAT_URL = import.meta.env.VITE_CHAT_URL || "";
export const SEARCH_URL = import.meta.env.VITE_SEARCH_URL || "";