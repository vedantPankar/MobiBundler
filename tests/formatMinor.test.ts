import { expect, test } from "vitest";
import { formatMinor } from "../app/bundles/format";

test("minor units format by currency exponent without float drift", () => {
  expect(formatMinor(159746, "USD", "en-US")).toBe("$1,597.46");
  expect(formatMinor(1, "USD", "en-US")).toBe("$0.01");
  expect(formatMinor(500, "JPY", "en-US")).toBe("¥500");
  expect(formatMinor(1234, "KWD", "en-US")).toMatch(/1\.234/);
});
