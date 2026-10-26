import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ORDER_BY_NUMBER_QUERY,
  ORDER_CAPTURE_QUERY,
  captureEnabled,
  writeCapture,
} from "../bundles/capture.server";

// DEV-ONLY, READ-ONLY. GET /app/dev/capture-order?number=1001 fetches that order through Admin GraphQL (queries
// only; nothing is modified) and writes the sanitized result to .captures/. The response reports where the file
// went, never the order data itself. Returns 404 in production or when MOBI_CAPTURE=off.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!captureEnabled()) throw new Response("Not found", { status: 404 });
  const { admin } = await authenticate.admin(request);

  const number = new URL(request.url).searchParams.get("number") ?? "";
  if (!/^\d{1,10}$/.test(number)) return Response.json({ ok: false, error: "number must be digits only" }, { status: 400 });

  type Lookup = {
    data?: { orders: { nodes: { id: string }[] } };
    errors?: { message: string; extensions?: { code?: string } }[];
  };
  let lookup: Lookup;
  try {
    lookup = (await (await admin.graphql(ORDER_BY_NUMBER_QUERY, { variables: { q: `name:${number}` } })).json()) as Lookup;
  } catch (e) {
    // The admin client throws on GraphQL access errors, e.g. protected-customer-data approval missing.
    return Response.json(
      { ok: false, error: (e as Error).message, hint: "Needs protected customer data access for the Order object." },
      { status: 403 },
    );
  }
  if (lookup.errors?.length) {
    return Response.json(
      { ok: false, error: lookup.errors[0].message, code: lookup.errors[0].extensions?.code ?? null,
        hint: "Missing read_orders? Restart `npm run dev` and approve the permission." },
      { status: 403 },
    );
  }
  const nodes = lookup.data?.orders.nodes ?? [];
  if (nodes.length !== 1) {
    return Response.json({ ok: false, error: nodes.length === 0 ? "order not found (only the last 60 days are readable)" : "ambiguous order number" }, { status: 404 });
  }

  const order = await (await admin.graphql(ORDER_CAPTURE_QUERY, { variables: { id: nodes[0].id } })).json();
  const file = await writeCapture("order-graphql", number, order);
  return Response.json({ ok: true, orderId: nodes[0].id, file });
};
