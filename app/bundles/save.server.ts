import { ZodError } from "zod";
import { fetchShopCurrency, fetchVariantsByIds, type CatalogAdmin } from "./shopifyCatalog.server";
import { parseBundleInput } from "./validation";
import type { BundleRepo } from "./repo.server";

export type SaveResult =
  | { ok: true; bundleId: string; syncMessage?: string }
  | { ok: false; fieldErrors: Record<string, string>; message?: string };

export async function saveBundle(
  d: {
    shop: string;
    admin: CatalogAdmin;
    repo: BundleRepo;
    sync: () => Promise<{ status: string; message?: string }>;
    id?: string;
    expectedVersion?: number;
  },
  raw: unknown,
): Promise<SaveResult> {
  let input;
  try {
    input = parseBundleInput(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of e.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
      return { ok: false, fieldErrors };
    }
    throw e;
  }

  // Never trust the form: every variant (and its product) is re-fetched with the session's Admin client.
  const found = await fetchVariantsByIds(
    d.admin,
    input.items.map((i) => i.variantId),
  );
  const bad = input.items.filter((i) => found.get(i.variantId)?.productId !== i.productId);
  if (bad.length) {
    return { ok: false, fieldErrors: { items: "One or more selected variants were not found in your store." } };
  }

  try {
    let bundleId: string;
    if (d.id) {
      const r = await d.repo.update(d.shop, d.id, d.expectedVersion ?? 0, input);
      if (r === null) return { ok: false, fieldErrors: {}, message: "Bundle not found." };
      if (r === "conflict") {
        return { ok: false, fieldErrors: {}, message: "This bundle changed in another tab. Reload and try again." };
      }
      bundleId = r.id;
    } else {
      bundleId = (await d.repo.create(d.shop, await fetchShopCurrency(d.admin), input)).id;
    }
    if (input.status !== "draft" || d.id) {
      const s = await d.sync();
      if (s.status === "error") return { ok: true, bundleId, syncMessage: s.message };
    }
    return { ok: true, bundleId };
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      return { ok: false, fieldErrors: { name: "A bundle with this name already exists." } };
    }
    throw e;
  }
}
