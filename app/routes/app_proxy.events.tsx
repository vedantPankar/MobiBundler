import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { bundleRepo } from "../bundles/index.server";
import { createEvents } from "../bundles/events.server";
import { createRateLimiter } from "../bundles/rateLimit.server";

const limiter = createRateLimiter(60, 60_000);
const events = createEvents(bundleRepo);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return new Response(null, { status: 204 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!limiter.allow(`${session.shop}:${ip}`)) return new Response(null, { status: 429 });
  try {
    const body = (await request.json()) as { bundleId?: string; type?: string; dedupeKey?: string };
    await events.record(session.shop, {
      bundleId: String(body.bundleId ?? ""),
      type: body.type as "view" | "add_to_cart",
      dedupeKey: String(body.dedupeKey ?? ""),
    });
  } catch {
    // Malformed analytics payloads are dropped silently; they must never surface to shoppers.
  }
  return new Response(null, { status: 204 });
};
