import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ORDER_BY_NAME_QUERY, captureEnabled, writeCapture } from "../bundles/capture.server";

// DEV-ONLY, read-only: fetches one existing order by its number (/app/capture?order=1001) and writes the sanitized
// GraphQL result to .captures/. It changes nothing in Shopify and is disabled in production.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  if (!captureEnabled()) throw new Response("Not found", { status: 404 });
  const order = new URL(request.url).searchParams.get("order") ?? "";
  if (!/^\d{1,10}$/.test(order)) return Response.json({ error: "Pass ?order=<order number>, e.g. ?order=1001" }, { status: 400 });

  const body = (await (await admin.graphql(ORDER_BY_NAME_QUERY, { variables: { q: `name:${order}` } })).json()) as {
    data?: { orders?: { nodes: unknown[] } };
    errors?: { message: string }[];
  };
  if (body.errors?.length) return Response.json({ error: body.errors[0].message }, { status: 502 });
  if (!body.data?.orders?.nodes.length) return Response.json({ error: `Order #${order} not found` }, { status: 404 });
  const file = await writeCapture("order-by-name", order, body);
  return Response.json({ saved: file });
};
