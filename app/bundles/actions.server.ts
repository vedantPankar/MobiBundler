import type { BundleRepo } from "./repo.server";
import type { BundleStatus } from "./types";

const STATUS: Record<string, BundleStatus> = {
  activate: "active",
  pause: "paused",
  archive: "archived",
};

export async function runBundleAction(
  deps: { shop: string; repo: BundleRepo; sync: () => Promise<{ status: string; message?: string }> },
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const intent = String(form.get("intent") ?? "");
  const ids = form.getAll("ids").map(String).slice(0, 100);
  if (ids.length === 0) return { ok: false, message: "Select at least one bundle." };

  if (intent === "duplicate") {
    for (const id of ids) await deps.repo.duplicate(deps.shop, id);
    return { ok: true, message: "Bundle duplicated as draft." };
  }

  const status = STATUS[intent];
  if (!status) return { ok: false, message: "Unknown action." };
  for (const id of ids) await deps.repo.setStatus(deps.shop, id, status);
  const r = await deps.sync();
  return r.status === "error"
    ? { ok: false, message: `Saved, but Shopify sync failed: ${r.message}` }
    : { ok: true, message: "Updated." };
}
