import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

async function shell(url) {
  const page = await fixture.context.newPage();
  await page.goto(url);
  await page.keyboard.press('Escape');
  return page;
}

test('every page carries one assistant launcher, and Ctrl+K opens it', async () => {
  for (const url of ['index.html', 'logs.html', 'note.html?slug=stm32-gpio', 'about.html', '404.html', 'write.html']) {
    const page = await shell(url);
    try {
      await page.waitForSelector('[data-agent-open]', { state: 'attached' });
      assert.equal(await page.locator('[data-agent-open]').count(), 1, `${url} should mount exactly one launcher`);
      // The writing desk hides it: its own F3/F4 panel already sits on that corner.
      const expected = url !== 'write.html';
      assert.equal(await page.isVisible('[data-agent-open]'), expected, `${url} launcher visibility (${await page.evaluate(() => document.querySelector('[data-agent-open]')?.getBoundingClientRect().toJSON())})`);
      if (!expected) {
        assert.equal(await page.locator('[data-write-action="polish"]').count(), 1, 'the desk keeps its own AI keys');
      }
    } finally { await page.close(); }
  }

  const page = await shell('logs.html');
  try {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('dialog.agent[open]');
    // Unconfigured first run opens the setup; a configured one opens the ask bar.
    const ready = await page.evaluate(() => ({
      setup: !document.querySelector('[data-agent-setup]').hidden,
      ask: !document.querySelector('[data-agent-form]').hidden
    }));
    assert.ok(ready.setup || ready.ask, 'the panel must open something usable');
  } finally { await page.close(); }
});

test('the corpus it sends really is this blog', async () => {
  const page = await shell('index.html');
  try {
    const stats = await page.evaluate(() => window.KawaiiAgent.corpusStats());
    assert.equal(stats.notes, 10);
    assert.ok(stats.chars > 6000, `corpus is only ${stats.chars} chars`);
  } finally { await page.close(); }
});

test('without a key it opens the setup instead of sending anything', async () => {
  const page = await shell('index.html');
  try {
    let called = false;
    await page.route('**/chat/completions', async (route) => {
      called = true;
      await route.abort();
    });
    await page.click('[data-agent-open]');
    await page.waitForSelector('[data-agent-setup]:not([hidden])');
    assert.equal(await page.isVisible('[data-agent-form]'), false, 'the ask bar gives way to the setup');
    const providers = await page.$$eval('[data-provider]', (nodes) => nodes.map((node) => node.textContent.trim()));
    assert.ok(providers.includes('DeepSeek'), `provider presets missing: ${providers}`);

    await page.click('[data-provider="kimi"]');
    const filled = await page.evaluate(() => ({
      endpoint: document.querySelector('[data-ai-field="endpoint"]').value,
      model: document.querySelector('[data-ai-field="model"]').value
    }));
    assert.match(filled.endpoint, /moonshot/, 'picking a provider fills the endpoint');
    assert.ok(filled.model.length > 3, 'picking a provider fills a default model');
    assert.equal(called, false, 'no request may leave without a saved key');
  } finally { await page.close(); }
});

test('the setup saves the key, tests it, and reports the result', async () => {
  const page = await shell('index.html');
  try {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    let seen = null;
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      seen = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: '在的' } }] })
      });
    });

    await page.click('[data-agent-open]');
    await page.click('[data-provider="deepseek"]');
    await page.fill('[data-ai-field="key"]', 'sk-setup-test');
    await page.click('[data-agent-save]');
    await page.waitForFunction(() => /连接成功/.test(document.querySelector('[data-agent-setup-msg]').textContent));
    assert.equal(seen.model, 'deepseek-chat');
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(sessionStorage.getItem('kawaii.ai.v1'))),
      { endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'sk-setup-test' }
    );
    await page.waitForFunction(() => document.querySelector('[data-agent-setup]').hidden);
  } finally { await page.close(); }
});

test('attachments travel with the question', async () => {
  const page = await shell('index.html');
  try {
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1', model: 'test-model', key: 'sk-attach', remember: false
    }));
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    let body = null;
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      body = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: '我看到了你的附件。' } }] })
      });
    });

    await page.click('[data-agent-open]');
    await page.setInputFiles('[data-agent-file]', {
      name: 'notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 我的实验记录\n\n上拉电阻 4.7k 不够。\n')
    });
    await page.waitForSelector('[data-agent-attachments] .agent__chip');
    assert.match(await page.textContent('.agent__chip-name'), /notes\.md/);

    await page.fill('[data-agent-input]', '这份记录说明了什么');
    await page.press('[data-agent-input]', 'Enter');
    await page.waitForFunction(() => /我看到了你的附件/.test(document.querySelector('[data-agent-log]').textContent));
    const content = body.messages.at(-1).content;
    assert.match(String(content), /【附件 notes\.md】/, 'the file text must be in the prompt');
    assert.match(String(content), /上拉电阻 4\.7k 不够/);
  } finally { await page.close(); }
});

test('it searches the site with a tool call, then answers from the result', async () => {
  const page = await shell('index.html');
  try {
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1',
      model: 'test-model',
      key: 'sk-agent-test',
      remember: false
    }));
    const bodies = [];
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    await page.route('**/chat/completions', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      bodies.push(JSON.parse(request.postData()));
      const reply = bodies.length === 1
        ? '{"tool":"search_notes","args":{"query":"I2C"}}'
        : 'I2C 那篇的结论是上拉太大加上走线电容，边沿已经被拉缓。';
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: reply } }] })
      });
    });

    await page.click('[data-agent-open]');
    await page.fill('[data-agent-input]', 'I2C 那篇讲了什么');
    await page.press('[data-agent-input]', 'Enter');
    await page.waitForFunction(() => /上拉太大/.test(document.querySelector('[data-agent-log]').textContent));

    assert.equal(bodies.length, 2, 'one tool round means exactly two requests');
    assert.match(bodies[0].messages[0].content, /【站内笔记】/, 'the system prompt must carry the corpus');
    assert.match(bodies[0].messages[0].content, /STM32|I2C|嵌入式/, 'the corpus should contain real note text');
    assert.match(bodies[1].messages.at(-1).content, /【search_notes 结果】/, 'the tool result must be fed back');
    assert.match(bodies[1].messages.at(-1).content, /debug-i2c-pullup|I2C/, 'the search result should name the note');
    assert.match(await page.textContent('.agent__trace'), /search_notes/);
  } finally { await page.close(); }
});

test('the terminal can hand a question to the assistant', async () => {
  const page = await shell('index.html');
  try {
    await page.keyboard.press('Backquote');
    await page.waitForSelector('#kawaii-terminal[open]');
    await page.fill('#terminal-input', 'ask 为什么要用 volatile');
    await page.press('#terminal-input', 'Enter');
    await page.waitForSelector('dialog.agent[open]');
    await page.waitForFunction(() => document.querySelector('[data-agent-input]').value === '为什么要用 volatile');
  } finally { await page.close(); }
});

test('the setup pulls the provider model list and fills the model field', async () => {
  const page = await shell('index.html');
  try {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    let modelsUrl = null;
    let modelsAuth = null;
    await page.route('**/models', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      modelsUrl = route.request().url();
      modelsAuth = route.request().headers()['authorization'];
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }, { id: 'deepseek-chat' }] })
      });
    });
    await page.click('[data-agent-open]');
    await page.waitForSelector('[data-agent-setup]:not([hidden])');
    await page.fill('[data-ai-field="key"]', 'sk-models-test');
    await page.click('[data-provider="deepseek"]');
    await page.waitForSelector('[data-ai-model-pick]:not([hidden])');
    const options = await page.$$eval('[data-ai-model-pick] option', (nodes) => nodes.map((node) => node.value).filter(Boolean));
    assert.deepEqual(options, ['deepseek-chat', 'deepseek-reasoner'], 'model ids must be deduped and sorted');
    assert.equal(modelsUrl, 'https://api.deepseek.com/v1/models');
    assert.equal(modelsAuth, 'Bearer sk-models-test');
    await page.selectOption('[data-ai-model-pick]', 'deepseek-reasoner');
    assert.equal(await page.inputValue('[data-ai-field="model"]'), 'deepseek-reasoner');
    await page.click('[data-agent-models]');
    await page.waitForFunction(() => /拉到 2 个模型/.test(document.querySelector('[data-agent-setup-msg]').textContent));
  } finally { await page.close(); }
});

test('a pulled list without the preset never shows an uncommitted selection', async () => {
  const page = await shell('index.html');
  try {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    await page.route('**/models', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-reasoner' }] })
      });
    });
    await page.click('[data-agent-open]');
    await page.waitForSelector('[data-agent-setup]:not([hidden])');
    await page.click('[data-provider="deepseek"]');
    await page.fill('[data-ai-field="key"]', 'sk-pick-test');
    await page.click('[data-agent-models]');
    await page.waitForSelector('[data-ai-model-pick]:not([hidden])');
    // The preset is absent from the list: re-clicking the shown option fires no change
    // event, so the picker must not display a model the field does not hold.
    assert.equal(await page.inputValue('[data-ai-field="model"]'), 'deepseek-chat');
    assert.equal(await page.$eval('[data-ai-model-pick]', (node) => node.value), '', 'the picker must not pre-show an uncommitted model');
    await page.selectOption('[data-ai-model-pick]', 'deepseek-flash');
    assert.equal(await page.inputValue('[data-ai-field="model"]'), 'deepseek-flash');
    await page.fill('[data-ai-field="model"]', 'deepseek-reasoner');
    assert.equal(await page.$eval('[data-ai-model-pick]', (node) => node.value), 'deepseek-reasoner', 'hand entry must re-mirror the picker');
    await page.selectOption('[data-ai-model-pick]', 'deepseek-reasoner');
    assert.equal(await page.inputValue('[data-ai-field="model"]'), 'deepseek-reasoner');
    await page.fill('[data-ai-field="model"]', 'my-finetune');
    assert.equal(await page.$eval('[data-ai-model-pick]', (node) => node.value), '', 'a model outside the list returns the picker to its placeholder');
  } finally { await page.close(); }
});

test('a failed model pull reports the error and keeps manual entry', async () => {
  const page = await shell('index.html');
  try {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    await page.route('**/models', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      await route.fulfill({
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { message: 'bad key' } })
      });
    });
    await page.click('[data-agent-open]');
    await page.waitForSelector('[data-agent-setup]:not([hidden])');
    await page.click('[data-provider="deepseek"]');
    await page.fill('[data-ai-field="key"]', 'sk-bad');
    await page.click('[data-agent-models]');
    await page.waitForFunction(() => document.querySelector('[data-agent-setup-msg]').classList.contains('is-error'));
    assert.match(await page.textContent('[data-agent-setup-msg]'), /401/);
    assert.equal(await page.isVisible('[data-ai-model-pick]'), false);
    await page.fill('[data-ai-field="model"]', 'manual-model');
    assert.equal(await page.inputValue('[data-ai-field="model"]'), 'manual-model');
  } finally { await page.close(); }
});

test('image questions degrade to text when the provider rejects vision', async () => {
  const page = await shell('index.html');
  try {
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1', model: 'test-model', key: 'sk-vision', remember: false
    }));
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    const bodies = [];
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      const body = JSON.parse(route.request().postData());
      bodies.push(body);
      const hasImage = JSON.stringify(body.messages).includes('image_url');
      await route.fulfill({
        status: hasImage ? 500 : 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify(hasImage
          ? { error: { message: 'Internal Server Error (request_id: 0000)', type: 'internal_error' } }
          : { choices: [{ message: { content: '我看不到图片本身，但按你的文字描述：这是一张像素立绘。' } }] })
      });
    });
    await page.click('[data-agent-open]');
    await page.setInputFiles('[data-agent-file]', {
      name: 'girl.png', mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex')
    });
    await page.waitForSelector('[data-agent-attachments] .agent__chip');
    await page.fill('[data-agent-input]', '你能看见这张照片吗');
    await page.press('[data-agent-input]', 'Enter');
    await page.waitForFunction(() => /我看不到图片本身/.test(document.querySelector('[data-agent-log]').textContent));
    assert.ok(bodies.length >= 2, 'the vision attempt and the text fallback must both happen');
    assert.ok(JSON.stringify(bodies[0].messages).includes('image_url'), 'the first attempt carries the image');
    const last = bodies.at(-1);
    assert.ok(!JSON.stringify(last.messages).includes('image_url'), 'the fallback must not resend the image');
    assert.match(String(last.messages.at(-1).content), /不支持图片/, 'the fallback prompt must say the image was not delivered');
    assert.match(await page.textContent('[data-agent-log]'), /不支持图片输入/, 'the user must be told about the degradation');
    assert.equal(await page.locator('.agent__msg--error').count(), 0, 'a successful fallback is not an error');
  } finally { await page.close(); }
});

test('provider 5xx becomes a friendly hint instead of raw JSON', async () => {
  const page = await shell('index.html');
  try {
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1', model: 'test-model', key: 'sk-500', remember: false
    }));
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    let calls = 0;
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      calls += 1;
      await route.fulfill({
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { message: 'Internal Server Error (request_id: 6be6c3fb)', type: 'internal_error', code: 'internal_error' } })
      });
    });
    await page.click('[data-agent-open]');
    await page.fill('[data-agent-input]', '在吗');
    await page.press('[data-agent-input]', 'Enter');
    await page.waitForSelector('.agent__msg--error');
    const message = await page.textContent('.agent__msg--error');
    assert.match(message, /HTTP 500/);
    assert.match(message, /服务商内部错误/);
    assert.ok(!message.includes('request_id'), 'raw provider JSON must not reach the reader');
    assert.equal(calls, 2, 'one automatic retry on 5xx, then surface the hint');
  } finally { await page.close(); }
});

test('save-and-test keeps the config and offers a retry path on 5xx', async () => {
  const page = await shell('index.html');
  try {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      await route.fulfill({
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { message: 'Internal Server Error (request_id: 09769435)', type: 'internal_error' } })
      });
    });
    await page.click('[data-agent-open]');
    await page.click('[data-provider="deepseek"]');
    await page.fill('[data-ai-field="key"]', 'sk-save-500');
    await page.click('[data-agent-save]');
    await page.waitForFunction(() => /服务商内部错误/.test(document.querySelector('[data-agent-setup-msg]').textContent));
    const msg = await page.textContent('[data-agent-setup-msg]');
    assert.match(msg, /已保存/);
    assert.match(msg, /重试/);
    assert.ok(!msg.includes('request_id'));
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('kawaii.ai.v1')).key), 'sk-save-500');
  } finally { await page.close(); }
});

test('it can flip the site itself when asked to', async () => {
  const page = await shell('index.html');
  try {
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1',
      model: 'test-model',
      key: 'sk-agent-test',
      remember: false
    }));
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    let round = 0;
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      round += 1;
      const reply = round === 1
        ? '{"tool":"site_action","args":{"theme":"line","fx":false}}'
        : '已经切成线稿，并关掉了动效。';
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: reply } }] })
      });
    });

    await page.click('[data-agent-open]');
    await page.fill('[data-agent-input]', '换成线稿并关掉动效');
    await page.press('[data-agent-input]', 'Enter');
    await page.waitForFunction(() => document.documentElement.dataset.skin === 'line');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fx), 'off');
    await page.waitForFunction(() => /已经切成线稿/.test(document.querySelector('[data-agent-log]').textContent));
    assert.match(await page.textContent('.agent__trace'), /site_action/);
  } finally { await page.close(); }
});

test('propose_resources stages a reviewed import instead of writing blindly', async () => {
  const page = await shell('index.html');
  try {
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1',
      model: 'test-model',
      key: 'sk-agent-propose',
      remember: false
    }));
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    let round = 0;
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      round += 1;
      const reply = round === 1
        ? '{"tool":"propose_resources","args":{"items":[{"title":"STM32 官方产品页","url":"https://www.st.com/en/microcontrollers-microprocessors/stm32-32-bit-arm-cortex-mcus.html","category":"数据手册","note":"官方入口"},{"title":"坏链接","url":"javascript:alert(1)"}]}}'
        : '已经放进资源库页的 AI 推荐区，你核对后导入。';
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: reply } }] })
      });
    });

    await page.click('[data-agent-open]');
    await page.fill('[data-agent-input]', '推荐几个 STM32 资源');
    await page.press('[data-agent-input]', 'Enter');
    await page.waitForFunction(() => /AI 推荐区|核对后导入/.test(document.querySelector('[data-agent-log]').textContent));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii.resource.proposals.v1') || 'null'));
    assert.equal(stored.items.length, 1, 'a javascript: URL never reaches the proposals');
    assert.equal(stored.items[0].title, 'STM32 官方产品页');
    assert.match(await page.textContent('.agent__trace'), /propose_resources/);
  } finally { await page.close(); }
});

test('the assistant can insert effect blocks and restyle the open article', async () => {
  const page = await shell('write.html');
  try {
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1',
      model: 'test-model',
      key: 'sk-agent-effects',
      remember: false
    }));
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    let round = 0;
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      round += 1;
      const reply = round === 1
        ? '{"tool":"insert_block","args":{"type":"callout-warning","text":"开漏要外部上拉"}}'
        : round === 2
          ? '{"tool":"apply_style","args":{"accent":"cyan","fx":"scan","cover":"template:circuit"}}'
          : '已加好警告框，并把强调色、动效和封面都换了。';
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: reply } }] })
      });
    });

    await page.evaluate(() => window.KawaiiAgent.open('加一个警告框，样式改成青色扫描和芯片封面'));
    await page.waitForFunction(() => /\[!WARNING\]/.test(document.querySelector('#write-screen').value), null, { timeout: 8000 });
    assert.match(await page.inputValue('#write-screen'), /开漏要外部上拉/);
    await page.waitForFunction(() => document.querySelector('[data-meta="accent"]').value === 'cyan');
    assert.equal(await page.inputValue('[data-meta="fx"]'), 'scan');
    assert.equal(await page.inputValue('[data-meta="cover"]'), 'template:circuit');
    assert.match(await page.textContent('.agent__trace'), /insert_block/);
    assert.match(await page.textContent('.agent__trace'), /apply_style/);
  } finally { await page.close(); }
});
