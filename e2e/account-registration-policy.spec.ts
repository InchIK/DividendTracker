import { expect, test } from '@playwright/test';

test('owner can toggle and save the new-account registration policy', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: {
    user: { userId: 'usr_owner', username: 'owner', displayName: 'Owner', role: 'owner', hasPassword: true },
  } }));

  await page.route('**/api/v1/auth/registration-policy', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { allowRegistration: true, source: 'environment' } });
      return;
    }
    await route.fulfill({ json: { allowRegistration: false, source: 'database' } });
  });

  await page.goto('/#/account');

  await expect(page.getByRole('heading', { name: '新帳號註冊' })).toBeVisible();
  const toggle = page.getByRole('switch', { name: '允許新帳號註冊' });
  await expect(toggle).toBeVisible();
  await expect(page.getByText('開放中', { exact: true })).toBeVisible();

  await toggle.uncheck();
  const updateRequest = page.waitForRequest((request) => (
    request.url().endsWith('/api/v1/auth/registration-policy') && request.method() === 'PUT'
  ));
  await page.getByRole('button', { name: '儲存註冊設定', exact: true }).click();
  expect((await updateRequest).postDataJSON()).toEqual({ allowRegistration: false });

  await expect(page.getByRole('status').filter({ hasText: '註冊設定已儲存' })).toBeVisible();
  await expect(page.getByText('已關閉', { exact: true })).toBeVisible();
});

test('regular users do not see or request the registration policy', async ({ page }) => {
  const policyRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/auth/registration-policy')) policyRequests.push(request.method());
  });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: {
    user: { userId: 'usr_user', username: 'member', displayName: 'Member', role: 'user', hasPassword: true },
  } }));

  await page.goto('/#/account');
  await expect(page.getByRole('heading', { name: '新帳號註冊' })).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(policyRequests).toEqual([]);
});
