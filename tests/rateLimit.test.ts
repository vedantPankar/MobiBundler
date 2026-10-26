import { expect, test } from "vitest";
import { createRateLimiter } from "../app/bundles/rateLimit.server";

test("allows up to the limit per window, per key, then recovers", () => {
  let t = 0;
  const rl = createRateLimiter(3, 1000, () => t);
  expect([1, 2, 3].map(() => rl.allow("a"))).toEqual([true, true, true]);
  expect(rl.allow("a")).toBe(false);
  expect(rl.allow("b")).toBe(true);
  t = 1001;
  expect(rl.allow("a")).toBe(true);
});
