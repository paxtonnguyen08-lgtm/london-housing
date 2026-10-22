// Edit this file to set up your group.
export const CONFIG = {
  // First names only. These become the "Who are you?" buttons.
  members: ["Paxton", "Jordan", "Maya", "Sam"],
  defaultBudget: 1200,
  // Where the scraper's listings are, tried in order. Falls back to sample data if none load.
  dataUrls: ["listings.json", "../data/listings.json"],
  sampleUrl: "sample-listings.json",
  // Filled in when Supabase is set up, so votes are shared across everyone's phones:
  // supabase: { url: "https://xxxx.supabase.co", anonKey: "..." }
  supabase: null,
};
