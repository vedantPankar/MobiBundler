import type { BundleRepo } from "./repo.server";

export type EventType = "view" | "add_to_cart";

const KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** Anonymous storefront events only: no customer, cart or price data is accepted or stored. */
export function createEvents(repo: BundleRepo) {
  return {
    async record(
      shop: string,
      e: { bundleId: string; type: EventType; dedupeKey: string },
    ): Promise<"recorded" | "duplicate" | "ignored"> {
      if (e.type !== "view" && e.type !== "add_to_cart") return "ignored";
      if (typeof e.dedupeKey !== "string" || !KEY.test(e.dedupeKey)) return "ignored";
      if (typeof e.bundleId !== "string" || e.bundleId.length > 64) return "ignored";
      return repo.recordEvent(shop, e.bundleId, e.type, e.dedupeKey);
    },
    counts(shop: string, sinceDays: number) {
      return repo.eventCounts(shop, sinceDays);
    },
  };
}
