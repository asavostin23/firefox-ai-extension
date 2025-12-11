const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_SETTINGS = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 512
};

function log(...args) {
  console.log('[AI Page Assistant]', ...args);
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: 'ai-selection',
    title: 'Ask AI about selection',
    contexts: ['selection']
  });
  api.contextMenus.create({
    id: 'ai-page',
    title: 'Ask AI about this page',
    contexts: ['page']
  });
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || (!info.selectionText && info.menuItemId === 'ai-selection')) {
    return;
  }

  const settings = await loadSettings();
  if (!settings.apiKey) {
    await api.tabs.create({ url: api.runtime.getURL('popup.html') });
    return;
  }

  let baseResult;

  try {
    const prompt = await buildPrompt(info, tab);
    baseResult = {
      source: info.menuItemId === 'ai-selection' ? 'selection' : 'page',
      question: prompt,
      url: tab.url || '',
      createdAt: Date.now()
    };

    await persistResult({ ...baseResult, status: 'loading', answer: '' });
    await api.tabs.create({ url: api.runtime.getURL('response.html') });

    const answer = await callModel(prompt, settings);

    await persistResult({
      ...baseResult,
      status: 'complete',
      answer,
      completedAt: Date.now()
    });
  } catch (error) {
    log('Error calling model', error);
    if (baseResult) {
      await persistResult({
        ...baseResult,
        status: 'error',
        answer: error?.message || String(error),
        completedAt: Date.now()
      });
    }
    api.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'AI request failed',
      message: error?.message || String(error)
    });
  }
});

async function buildPrompt(info, tab) {
  if (info.menuItemId === 'ai-selection') {
    const tabId = tab.id;
    const selectionText = (info.selectionText || '').trim().slice(0, 4000);
    const { title, text } = await getPageContext(tabId, 8000);

    return `Provide a concise explanation for the following selection using the surrounding page context and include a short actionable insight if relevant.\n\nPage URL: ${tab.url}\nPage Title: ${title || 'Untitled'}\nPage text snippet:\n${text}\n\nSelection:\n${selectionText}`;
  }

  const tabId = tab.id;
  const { title, text } = await getPageContext(tabId);
  return `Provide a brief summary of this page and list the top 3 takeaways.\n\nURL: ${tab.url}\nTitle: ${title || 'Untitled'}\nContent:\n${text}`;
}

async function getPageContext(tabId, sliceLength = 12000) {
  const pageData = await api.tabs.executeScript(tabId, {
    code: `(() => {
      const clone = document.body.cloneNode(true);
      const scripts = clone.querySelectorAll('script,style,noscript');
      scripts.forEach(el => el.remove());
      const text = clone.innerText || '';
      return { title: document.title || '', text: text.slice(0, ${sliceLength}) };
    })();`
  });
  const context = Array.isArray(pageData) ? pageData[0] : {};
  return { title: context?.title || '', text: context?.text || '' };
}

async function callModel(prompt, settings) {
  const provider = settings.provider || 'openai';
  if (provider === 'anthropic') {
    return callAnthropic(prompt, settings);
  }
  return callOpenAI(prompt, settings);
}

async function callOpenAI(prompt, settings) {
  const response = await fetch(settings.baseUrl || DEFAULT_SETTINGS.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_SETTINGS.model,
      temperature: Number(settings.temperature ?? DEFAULT_SETTINGS.temperature),
      max_tokens: Number(settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens),
      messages: [
        { role: 'system', content: 'You are a helpful assistant for summarizing web content.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-style API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message?.content;
  if (!message) {
    throw new Error('No content returned from OpenAI-style API');
  }
  return message.trim();
}

async function callAnthropic(prompt, settings) {
  const url = settings.baseUrl || 'https://api.anthropic.com/v1/messages';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.model || 'claude-3-haiku-20240307',
      max_tokens: Number(settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens),
      temperature: Number(settings.temperature ?? DEFAULT_SETTINGS.temperature),
      system: 'You are a helpful assistant for summarizing web content.',
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = data?.content?.[0]?.text;
  if (!content) {
    throw new Error('No content returned from Anthropic API');
  }
  return content.trim();
}

async function loadSettings() {
  return new Promise(resolve => {
    api.storage.local.get(DEFAULT_SETTINGS, (items) => resolve(items));
  });
}

async function persistResult(result) {
  return new Promise((resolve, reject) => {
    api.storage.local.set({ lastResult: result }, () => {
      if (api.runtime.lastError) {
        reject(api.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}
