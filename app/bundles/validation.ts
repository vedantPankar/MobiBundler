import { z } from "zod";
import type { BundleInput } from "./types";

const variantGid = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/);
const productGid = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/);

export const bundleInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a bundle name.").max(100, "Name must be 100 characters or fewer."),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["draft", "active", "paused", "archived"]),
    pricingKind: z.enum(["percentage", "fixed_amount_off"]),
    pricingValue: z.number({ error: "Enter a discount value." }).int().positive("Enter a discount value."),
    buttonLabel: z.string().trim().max(40).optional(),
    showSavings: z.boolean().optional(),
    items: z
      .array(
        z.object({
          productId: productGid,
          variantId: variantGid,
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(2, "Select at least two products.")
      .max(10, "A bundle can have at most 10 variants."),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.variantId)).size !== v.items.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "Each variant can appear only once" });
    }
    if (v.pricingKind === "percentage" && v.pricingValue > 10000) {
      ctx.addIssue({ code: "custom", path: ["pricingValue"], message: "Percentage must be 0.01–100" });
    }
  }) satisfies z.ZodType<BundleInput>;

export const parseBundleInput = (raw: unknown): BundleInput => bundleInputSchema.parse(raw);
