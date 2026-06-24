// ============================================================
//  All editable text lives here. Change copy without touching
//  layout or styling. Swap the headshot by replacing the image
//  file and setting `headshot` below (see note).
// ============================================================

export const content = {
  // --- Identity / hero ---
  name: "Yazan Alnajm",
  valueLine: "AI & ML Developer — semantic search, LLM pipelines, RAG systems.",
  pitch:
    "I build end-to-end AI retrieval systems — from data pipelines and fine-tuned embeddings to vector search and APIs.",

  // Headshot: leave as null to show the placeholder block.
  // To use a real photo: drop the file in src/assets/ (e.g. headshot.jpg),
  // add `import headshot from "./assets/headshot.jpg"` at the top of App.jsx,
  // and pass it through — or simplest, set this to a public-folder path
  // like "/headshot.jpg" after putting the file in the `public/` folder.
  headshot: null,

  // --- Interactive block ---
  toggle: {
    defaultMode: "chat", // "chat" | "search"
    chatLabel: "Ask about me",
    searchLabel: "Film search",
  },

  chat: {
    placeholder: "Ask whether my background fits a role or task…",
    emptyHint:
      "Ask about my experience, my diploma project, or whether I'd fit a specific task.",
    examples: [
      "Does Yazan have experience with RAG systems?",
      "Has he built anything end-to-end?",
      "What did he do for his thesis?",
    ],
  },

  search: {
    placeholder: "Describe a film in your own words…",
    emptyHint:
      "Search 32,364 films by meaning, not keywords. Try a vague, conversational description.",
    examples: [
      "a heist that goes wrong because of trust",
      "lonely robot learns what it means to be human",
      "slow-burn detective story in a rainy city",
    ],
  },

  // --- Footer / contact ---
  contact: {
    email: "yazanalnajm19@gmail.com",
    telegram: "darkinstar", // without @
    github: "DarkinStar",
  },
};
