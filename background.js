const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_SETTINGS = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  responseTarget: 'tab',
  temperature: 0.3,
  maxTokens: 4096
};

const SYSTEM_PROMPT = 'You are a helpful assistant for summarizing web content.';
const STORAGE_KEY = 'conversation';
const responsePorts = new Set();
const RESPONSE_TARGETS = ['tab', 'sidebar', 'both'];

function getDefaultBaseUrl(provider) {
  return provider === 'anthropic'
    ? 'https://api.anthropic.com/v1/messages'
    : DEFAULT_SETTINGS.baseUrl;
}

function normalizeSettings(settings) {
  const provider = settings.provider || DEFAULT_SETTINGS.provider;
  let baseUrl = settings.baseUrl;
  const responseTarget = RESPONSE_TARGETS.includes(settings.responseTarget)
    ? settings.responseTarget
    : DEFAULT_SETTINGS.responseTarget;

  if (!baseUrl || (provider === 'anthropic' && baseUrl === DEFAULT_SETTINGS.baseUrl)) {
    baseUrl = getDefaultBaseUrl(provider);
  }

  return {
    ...settings,
    provider,
    baseUrl,
    responseTarget,
  };
}

function log(...args) {
  console.log('[AI Page Assistant]', ...args);
}

function openSidebar() {
  if (!api.sidebarAction?.open) {
    log('Sidebar API is not available in this browser.');
    return Promise.resolve();
  }

  try {
    return api.sidebarAction.open();
  } catch (error) {
    log('Failed to open sidebar', error);
    return Promise.resolve();
  }
}

function openResponseViews(target) {
  const shouldOpenTab = target === 'tab' || target === 'both';
  const shouldOpenSidebar = target === 'sidebar' || target === 'both';

  return {
    tabPromise: shouldOpenTab
      ? api.tabs.create({ url: api.runtime.getURL('response.html') })
      : Promise.resolve(),
    sidebarPromise: shouldOpenSidebar ? openSidebar() : Promise.resolve()
  };
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

  const settings = normalizeSettings(await loadSettings());
  if (!settings.apiKey) {
    await api.tabs.create({ url: api.runtime.getURL('popup.html') });
    return;
  }

  try {
    const prompt = await buildPrompt(info, tab);
    const conversationMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt.content, displayText: prompt.displayText }
    ];
    const { tabPromise: responseTabPromise, sidebarPromise } = openResponseViews(settings.responseTarget);

    const initialConversation = buildConversation({
      source: info.menuItemId === 'ai-selection' ? 'selection' : 'page',
      url: tab.url || '',
      messages: conversationMessages,
      settings
    });

    await persistConversation(initialConversation);
    broadcastConversation(initialConversation);

    const answer = await callModel(
      toModelMessages(conversationMessages),
      settings,
      (chunk) => broadcastToken(chunk)
    );

    const conversation = {
      ...initialConversation,
      messages: [...conversationMessages, { role: 'assistant', content: answer }],
      updatedAt: Date.now()
    };

    await persistConversation(conversation);
    broadcastConversation(conversation);
    await Promise.all([responseTabPromise, sidebarPromise]);
  } catch (error) {
    log('Error calling model', error);
    api.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'AI request failed',
      message: error?.message || String(error)
    });
  }
});

api.runtime.onConnect.addListener((port) => {
  if (port.name !== 'response-view') return;

  responsePorts.add(port);

  port.onMessage.addListener(async (message) => {
    if (message?.type === 'get-conversation') {
      const conversation = await getConversation();
      port.postMessage({ type: 'conversation', conversation });
    }

    if (message?.type === 'followup') {
      await handleFollowUp(message.prompt, port);
    }
  });

  port.onDisconnect.addListener(() => {
    responsePorts.delete(port);
  });
});

async function buildPrompt(info, tab) {
  if (info.menuItemId === 'ai-selection') {
    const tabId = tab.id;
    const selectionText = (info.selectionText || '').trim().slice(0, 4000);
    const { title, text } = await getPageContext(tabId, 8000);

    return {
      displayText: `Asking about selection on ${tab.url}`,
      content: `Provide a concise explanation for the following selection using the surrounding page context and include a short actionable insight if relevant.\n\nPage URL: ${tab.url}\nPage Title: ${title || 'Untitled'}\nPage text snippet:\n${text}\n\nSelection:\n${selectionText}`
    };
  }

  const tabId = tab.id;
  const { title, text } = await getPageContext(tabId);
  return {
    displayText: `Summarizing page ${tab.url}`,
    content: `Provide a brief summary of this page and list the top 3 takeaways.\n\nURL: ${tab.url}\nTitle: ${title || 'Untitled'}\nContent:\n${text}`
  };
}

function toModelMessages(messages) {
  return messages.map(({ role, content }) => ({ role, content }));
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

async function callModel(messages, settings, onToken) {
  const provider = settings.provider || 'openai';
  if (provider === 'anthropic') {
    return callAnthropic(messages, settings, onToken);
  }
  return callOpenAI(messages, settings, onToken);
}

function getSystemAndMessages(messages) {
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');
  return { system: systemMessage?.content, chatMessages };
}

async function callOpenAI(messages, settings, onToken) {
  const url = settings.baseUrl || getDefaultBaseUrl('openai');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_SETTINGS.model,
      temperature: Number(settings.temperature ?? DEFAULT_SETTINGS.temperature),
      max_tokens: Number(settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens),
      stream: Boolean(onToken),
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-style API error (${response.status}): ${text}`);
  }

  if (!onToken) {
    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content;
    if (!message) {
      throw new Error('No content returned from OpenAI-style API');
    }
    return message.trim();
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response stream available');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onToken?.(delta);
        }
      } catch (err) {
        log('Failed to parse OpenAI stream chunk', err);
      }
    }
  }

  return fullText.trim();
}

async function callAnthropic(messages, settings, onToken) {
  const url = settings.baseUrl || getDefaultBaseUrl('anthropic');
  const { system, chatMessages } = getSystemAndMessages(messages);
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
      system,
      messages: chatMessages,
      stream: Boolean(onToken)
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  if (!onToken) {
    const data = await response.json();
    const content = data?.content?.[0]?.text;
    if (!content) {
      throw new Error('No content returned from Anthropic API');
    }
    return content.trim();
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response stream available');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        const delta = json?.delta?.text;
        if (delta) {
          fullText += delta;
          onToken?.(delta);
        }
      } catch (err) {
        log('Failed to parse Anthropic stream chunk', err);
      }
    }
  }

  return fullText.trim();
}

async function loadSettings() {
  return new Promise(resolve => {
    api.storage.local.get(DEFAULT_SETTINGS, (items) => resolve(items));
  });
}

function buildConversation({ source, url, messages, settings }) {
  const provider = settings.provider || DEFAULT_SETTINGS.provider;
  return {
    source,
    url,
    createdAt: Date.now(),
    provider,
    model: settings.model || DEFAULT_SETTINGS.model,
    temperature: Number(settings.temperature ?? DEFAULT_SETTINGS.temperature),
    maxTokens: Number(settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens),
    baseUrl: settings.baseUrl || getDefaultBaseUrl(provider),
    messages
  };
}

async function persistConversation(conversation) {
  return new Promise((resolve, reject) => {
    api.storage.local.set({ [STORAGE_KEY]: conversation }, () => {
      if (api.runtime.lastError) {
        reject(api.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

async function getConversation() {
  return new Promise((resolve) => {
    api.storage.local.get([STORAGE_KEY], ({ [STORAGE_KEY]: conversation }) => {
      resolve(conversation || null);
    });
  });
}

function broadcastConversation(conversation) {
  responsePorts.forEach((port) => {
    try {
      port.postMessage({ type: 'conversation', conversation });
    } catch (err) {
      log('Failed to send conversation to a port', err);
    }
  });
}

function broadcastToken(chunk) {
  if (!chunk) return;
  responsePorts.forEach((port) => {
    try {
      port.postMessage({ type: 'token', chunk });
    } catch (err) {
      log('Failed to send token to a port', err);
    }
  });
}

async function handleFollowUp(prompt, port) {
  const question = (prompt || '').trim();
  if (!question) {
    port?.postMessage({ type: 'error', message: 'Please enter a prompt to continue the conversation.' });
    return;
  }

  const conversation = await getConversation();
  if (!conversation) {
    port?.postMessage({ type: 'error', message: 'No previous conversation found.' });
    return;
  }

  const settings = await loadSettings();
  if (!settings.apiKey) {
    port?.postMessage({ type: 'error', message: 'Add your API key in the extension settings to continue.' });
    return;
  }

  const mergedSettings = normalizeSettings({
    ...settings,
    provider: conversation.provider || settings.provider,
    model: conversation.model || settings.model,
    baseUrl: conversation.baseUrl || settings.baseUrl || getDefaultBaseUrl(conversation.provider || settings.provider),
    temperature: conversation.temperature ?? settings.temperature,
    maxTokens: conversation.maxTokens ?? settings.maxTokens
  });

  const newUserMessage = { role: 'user', content: question, displayText: question };
  const messages = [...conversation.messages, newUserMessage];

  try {
    const answer = await callModel(toModelMessages(messages), mergedSettings, (chunk) => broadcastToken(chunk));
    const updatedConversation = {
      ...conversation,
      messages: [...messages, { role: 'assistant', content: answer }],
      updatedAt: Date.now()
    };

    await persistConversation(updatedConversation);
    broadcastConversation(updatedConversation);
  } catch (error) {
    const message = error?.message || String(error);
    log('Follow-up failed', message);
    port?.postMessage({ type: 'error', message });
  }
}
