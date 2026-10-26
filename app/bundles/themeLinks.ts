// The theme app extension block is blocks/bundle.liquid, so its deep-link handle is "bundle".
export const BUNDLE_BLOCK_HANDLE = "bundle";

/** Opens the theme editor on a product template with the Bundle block ready to add. UNVERIFIED live. */
export function themeEditorDeepLink(shop: string, apiKey: string): string {
  const q = new URLSearchParams({
    template: "product",
    addAppBlockId: `${apiKey}/${BUNDLE_BLOCK_HANDLE}`,
    target: "newAppsSection",
  });
  return `https://${shop}/admin/themes/current/editor?${q.toString()}`;
}
