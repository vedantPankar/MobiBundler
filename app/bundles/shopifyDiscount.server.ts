import { BUNDLE_DISCOUNT_TITLE, CONFIG_KEY, CONFIG_NAMESPACE } from "./config";
import { ShopifyUserError, type DiscountGateway } from "./sync.server";

// UNVERIFIED against a live store. Mutation shapes follow the 2026-07 Admin GraphQL docs, but nothing here
// has been executed: whether `metafields` with the `$app` namespace is accepted on create/update, and the
// actual combination behavior, are open questions (see README "Unverified behavior").
type Vars = Record<string, unknown>;
type Admin = { graphql: (q: string, o?: { variables?: Vars }) => Promise<Response> };

// Conservative default: do not combine with other product/order discounts; shipping may combine.
const COMBINES = { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true };
const FUNCTION_HANDLE = "bundle-discount";

const CREATE = `#graphql
mutation CreateSharedBundleDiscount($input: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticAppDiscount: $input) {
    automaticAppDiscount { discountId }
    userErrors { field message code }
  }
}`;
const UPDATE = `#graphql
mutation UpdateSharedBundleDiscount($id: ID!, $input: DiscountAutomaticAppInput!) {
  discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $input) {
    automaticAppDiscount { discountId }
    userErrors { field message code }
  }
}`;
const ACTIVATE = `#graphql
mutation ActivateBundleDiscount($id: ID!) {
  discountAutomaticActivate(id: $id) { userErrors { field message } }
}`;
const DEACTIVATE = `#graphql
mutation DeactivateBundleDiscount($id: ID!) {
  discountAutomaticDeactivate(id: $id) { userErrors { field message } }
}`;
const INSPECT = `#graphql
query InspectBundleDiscount($id: ID!, $ns: String!, $key: String!) {
  discountNode(id: $id) {
    discount { __typename ... on DiscountAutomaticApp { status } }
    metafield(namespace: $ns, key: $key) { value }
  }
}`;

async function call(admin: Admin, query: string, variables: Vars) {
  const res = await admin.graphql(query, { variables });
  // GraphQL responses are dynamically shaped; each caller reads only the fields its query selects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await res.json()) as { data?: any; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Shopify GraphQL error: ${body.errors[0].message}`);
  return body.data;
}

function assertNoUserErrors(errs?: { message: string }[]) {
  if (errs?.length) throw new ShopifyUserError(errs.map((e) => e.message).join("; "));
}

const discountInput = (configJson: string, extra: object = {}) => ({
  title: BUNDLE_DISCOUNT_TITLE,
  functionHandle: FUNCTION_HANDLE,
  discountClasses: ["PRODUCT"],
  combinesWith: COMBINES,
  metafields: [{ namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: configJson }],
  ...extra,
});

export function adminDiscountGateway(admin: Admin): DiscountGateway {
  return {
    async create(configJson) {
      const d = await call(admin, CREATE, {
        input: discountInput(configJson, { startsAt: new Date().toISOString() }),
      });
      assertNoUserErrors(d.discountAutomaticAppCreate.userErrors);
      return { discountId: d.discountAutomaticAppCreate.automaticAppDiscount.discountId };
    },
    async update(id, configJson) {
      const d = await call(admin, UPDATE, { id, input: discountInput(configJson) });
      assertNoUserErrors(d.discountAutomaticAppUpdate.userErrors);
    },
    async setActive(id, active) {
      const d = await call(admin, active ? ACTIVATE : DEACTIVATE, { id });
      assertNoUserErrors((active ? d.discountAutomaticActivate : d.discountAutomaticDeactivate).userErrors);
    },
    async inspect(id) {
      const d = await call(admin, INSPECT, { id, ns: CONFIG_NAMESPACE, key: CONFIG_KEY });
      if (!d.discountNode) return null;
      return {
        status: d.discountNode.discount?.status ?? "UNKNOWN",
        configJson: d.discountNode.metafield?.value ?? null,
      };
    },
  };
}

export const __queries = { CREATE, UPDATE, ACTIVATE, DEACTIVATE, INSPECT };
