import { expect, test } from "@playwright/test";

test("login page presents account and password fields", async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: { error: '請先登入' } }));
  await page.route('**/api/v1/auth/config', (route) => route.fulfill({ json: {
    appName: 'DividendTracker', registrationEnabled: true, firstAccount: false,
    passwordMinimumLength: 12, google: { enabled: false, clientId: null },
  } }));
  await page.goto("/#/login");

  await expect(page.getByRole("heading", { name: "DividendTracker" })).toBeVisible();
  await expect(page.getByLabel("帳號")).toBeVisible();
  await expect(page.getByLabel("密碼")).toBeVisible();
  await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
});
