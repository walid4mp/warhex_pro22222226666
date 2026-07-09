import { test, expect } from '@playwright/test';

test('landing page and auth navigation render', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /رويال سكوير/i })).toBeVisible();
  await page.getByRole('link', { name: /تسجيل الدخول/i }).click();
  await expect(page.getByRole('heading', { name: /تسجيل الدخول/i })).toBeVisible();
  await page.getByRole('link', { name: /ليس لديك حساب/i }).click();
  await expect(page.getByRole('heading', { name: /إنشاء حساب/i })).toBeVisible();
});
