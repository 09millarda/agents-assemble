import { expect, test } from "bun:test";
import { canEnrollBrowser, hasDeniedNotifications, shouldReplaceExpiredSubscription } from "./browserEnrollmentPolicy";
test("enrollment requires granted permission and expired subscriptions need replacement", () => {
  expect(canEnrollBrowser("granted")).toBe(true);
  expect(canEnrollBrowser("default")).toBe(false);
  expect(hasDeniedNotifications("denied")).toBe(true);
  expect(shouldReplaceExpiredSubscription("expired")).toBe(true);
  expect(shouldReplaceExpiredSubscription("enrolled")).toBe(false);
});
