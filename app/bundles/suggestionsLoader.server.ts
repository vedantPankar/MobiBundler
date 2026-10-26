import { bundleRepo } from "./index.server";
import { fetchBaskets } from "./ordersSource.server";
import { fetchVariantDetails } from "./shopifyCatalog.server";
import { classifySyncError } from "./revenueSync.server";
import { buildSuggestions, createSuggestionCache, type SuggestionResult } from "./suggestions.server";

type Admin = Parameters<typeof fetchBaskets>[0] & Parameters<typeof fetchVariantDetails>[0];

// One cache for every page that shows suggestions (the Suggestions page and the dashboard), per server process.
const cache = createSuggestionCache();

export type SuggestionsOutcome = { result: SuggestionResult; error: null } | { result: null; error: { code: string; message: string } };

/** Never throws: a failure becomes an error the page can show (for example the order-access approval banner). */
export async function getSuggestions(shop: string, admin: Admin): Promise<SuggestionsOutcome> {
  const hit = cache.get(shop);
  if (hit) return { result: hit, error: null };
  try {
    const result = await buildSuggestions({
      now: new Date(),
      bundles: await bundleRepo.list(shop),
      fetchBaskets: (since) => fetchBaskets(admin, since),
      fetchVariants: (ids) => fetchVariantDetails(admin, ids),
    });
    cache.set(shop, result);
    return { result, error: null };
  } catch (e) {
    return { result: null, error: classifySyncError(e) };
  }
}

export const clearSuggestions = (shop: string) => cache.clear(shop);
