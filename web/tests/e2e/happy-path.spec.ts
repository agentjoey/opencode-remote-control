import { test, expect } from '@playwright/test'

test.describe('happy path', () => {
  test.skip(true, '需要手动验证：启动 bot + mock opencode + headless Chrome')

  test('dev bypass login → select session → send prompt → observe streaming', async () => {
    // TODO: 实现 E2E 测试
    // 1. 启动 bot (WEB_ENABLED=true, WEB_CF_ACCESS_DEV_BYPASS=true)
    // 2. 使用 headless Chrome 访问 http://localhost:7081
    // 3. 验证页面加载
    // 4. 发送消息
    // 5. 验证 streaming 卡片出现
  })
})
