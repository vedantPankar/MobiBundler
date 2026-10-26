import type { ActionFunctionArgs, HeadersArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigate, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { fetchShopCurrency } from "../bundles/shopifyCatalog.server";
import { SuggestionsSection } from "../bundles/SuggestionsSection";
import { clearSuggestions, getSuggestions } from "../bundles/suggestionsLoader.server";

// "Refresh" drops this shop's cached result; the loader then recomputes it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  clearSuggestions(session.shop);
  return null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const currency = await fetchShopCurrency(admin).catch(() => "USD");
  return { currency, ...(await getSuggestions(session.shop, admin)) };
};

export default function Suggestions() {
  const { currency, result, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Suggested bundles">
      <SuggestionsSection
        currency={currency}
        result={result}
        error={error}
        onCreate={(url) => navigate(url)}
        refreshControl={
          <Form method="post">
            <button type="submit" disabled={busy}>
              {busy ? "Refreshing…" : "Refresh suggestions"}
            </button>
          </Form>
        }
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
