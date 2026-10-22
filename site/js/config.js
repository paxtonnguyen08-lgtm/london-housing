// Edit this file to set up your group.
export const CONFIG = {
  // First names only. These become the "Who are you?" buttons.
  members: ["Paxton", "Charlie", "Xavier", "Jack", "Tyler"],
  defaultBudget: 1200,
  // Where the scraper's listings are, tried in order. Falls back to sample data if none load.
  dataUrls: ["listings.json", "../data/listings.json"],
  sampleUrl: "sample-listings.json",
  // Shared votes across everyone's phones. The publishable key is safe to be public:
  // it can only call the group-code-checked functions, never read the tables.
  supabase: {
    url: "https://blfcbaqvwceziilsubox.supabase.co",
    anonKey: "sb_publishable_5hkbWbg560Ac1beZzZYLYQ_3OaSi9NF",
  },
};
