import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('offline demo shows 12 stored matches', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ARAM_WRAPPED_MODE: 'demo',
      ARAM_WRAPPED_OFFLINE: '1',
      ARAM_WRAPPED_DATA_DIR: dataDir,
      ARAM_WRAPPED_FORCE_SCALE: '1'
    }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('hero-games')).toContainText('12', { timeout: 20000 })
    await expect(page.getByTestId('hero-winrate')).toContainText('58.3%')
    await expect(page.getByTestId('mode-badge')).toContainText('演示')
    await expect(page.getByTestId('notice-demo-only')).toBeVisible()
    await page.getByTestId('preset-custom').click()
    await page.getByTestId('custom-start').fill('2020-01-01')
    await page.getByTestId('custom-end').fill('2020-01-02')
    await expect(page.getByTestId('notice-no-matches-in-range')).toBeVisible()
  } finally {
    await app.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
