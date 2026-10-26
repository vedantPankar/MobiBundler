import { describe, expect, test } from "vitest";
import { buildOrderRows, parseOrderFilter, type OrderRecordLite, type RevenueRowLite } from "../app/bundles/orderRows";

const rec = (over: Partial<OrderRecordLite> = {}): OrderRecordLite => ({
  orderId: "gid://shopify/Order/8693648851130", orderName: "#1001", orderedAt: new Date("2026-10-24T17:20:46Z"), cancelledAt: null,
  source: "backfill", reconciled: true, reconcileNote: null, unmappedRefundMinor: 0, ...over,
});
const row = (over: Partial<RevenueRowLite> = {}): RevenueRowLite => ({
  orderId: "gid://shopify/Order/8693648851130", bundleId: "b1", unitsSold: 2, unitsRefunded: 0, soldGrossMinor: 177495, soldDiscountMinor: 17749, netMinor: 159746, ...over,
});
const names = new Map([["b1", "FBT"], ["b2", "Pair"]]);

describe("order list rows", () => {
  test("a plain paid order: label, link id, source, bundle name and the money columns", () => {
    const [r] = buildOrderRows([rec()], [row()], names);
    expect(r).toMatchObject({
      label: "#1001", numericId: "8693648851130", source: "historical", state: "paid", estimate: false,
      unitsSold: 2, grossMinor: 177495, discountMinor: 17749, netMinor: 159746, refundedMinor: 0,
    });
    expect(r.bundles).toEqual([{ bundleId: "b1", name: "FBT", units: 2 }]);
  });

  test("live orders are labelled live; backfilled ones historical", () => {
    expect(buildOrderRows([rec({ source: "live" })], [row()], names)[0].source).toBe("live");
  });

  test("two bundles on one order are one row with summed money and both names", () => {
    const [r] = buildOrderRows([rec()], [row(), row({ bundleId: "b2", unitsSold: 2, soldGrossMinor: 1000, soldDiscountMinor: 100, netMinor: 900 })], names);
    expect(r.bundles.map((b) => b.name)).toEqual(["FBT", "Pair"]);
    expect([r.unitsSold, r.grossMinor, r.discountMinor, r.netMinor]).toEqual([4, 178495, 17849, 160646]);
  });

  test("refund states: partly refunded, fully refunded, cancelled", () => {
    const partly = buildOrderRows([rec()], [row({ unitsRefunded: 1, netMinor: 80000 })], names)[0];
    expect(partly.state).toBe("partly_refunded");
    expect(partly.refundedMinor).toBe(177495 - 17749 - 80000);
    expect(buildOrderRows([rec()], [row({ unitsRefunded: 2, netMinor: 0 })], names)[0].state).toBe("refunded");
    const cancelled = buildOrderRows([rec({ cancelledAt: new Date() })], [row({ netMinor: 0 })], names)[0];
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.refundedMinor).toBe(159746); // the whole order's value is out of revenue
  });

  test("an estimate carries its reason; a reconciled order carries none", () => {
    const e = buildOrderRows([rec({ reconciled: false, reconcileNote: "line X: replay discounts 7499 but Shopify recorded 0" })], [row()], names)[0];
    expect(e).toMatchObject({ estimate: true, estimateReason: "line X: replay discounts 7499 but Shopify recorded 0" });
    expect(buildOrderRows([rec({ reconcileNote: "quantity changed" })], [row()], names)[0].estimateReason).toBeNull();
  });

  test("an order stored before its number was captured gets a readable fallback; a deleted bundle is named as such", () => {
    const [r] = buildOrderRows([rec({ orderName: null })], [row({ bundleId: "gone" })], names);
    expect(r.label).toBe("Order …851130");
    expect(r.bundles[0].name).toBe("Deleted bundle");
  });

  test("an order with no revenue rows (bundle removed by an edit) shows zeros, not a crash", () => {
    const [r] = buildOrderRows([rec()], [], names);
    expect([r.unitsSold, r.grossMinor, r.netMinor, r.state]).toEqual([0, 0, 0, "paid"]);
    expect(r.bundles).toEqual([]);
  });

  test("refunds that name no products are carried through for display", () => {
    expect(buildOrderRows([rec({ unmappedRefundMinor: 2500 })], [row()], names)[0].unmappedRefundMinor).toBe(2500);
  });

  test("filter parsing accepts only known values", () => {
    expect(parseOrderFilter("estimates")).toBe("estimates");
    expect(parseOrderFilter("<script>")).toBe("all");
    expect(parseOrderFilter(null)).toBe("all");
  });
});
