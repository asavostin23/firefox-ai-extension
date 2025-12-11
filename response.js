const api = typeof browser !== 'undefined' ? browser : chrome;

function $(id) {
  return document.getElementById(id);
}

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function sanitizeFragment(root) {
  if (!root) return;
  root.querySelectorAll('script, style').forEach((node) => node.remove());
}

const allowedTags = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'blockquote',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'a',
  'hr',
  'img',
  'span',
  'div',
]);

const uriSafePattern = /^(https?:|mailto:|#|\/)/i;

function sanitizeNode(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const tag = node.tagName.toLowerCase();

  if (!allowedTags.has(tag)) {
    const fragment = doc.createDocumentFragment();
    node.childNodes.forEach((child) => {
      const sanitizedChild = sanitizeNode(child, doc);
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild);
      }
    });
    return fragment;
  }

  const cleanElement = doc.createElement(tag);

  if (tag === 'a') {
    const href = node.getAttribute('href');
    if (href && uriSafePattern.test(href.trim())) {
      cleanElement.setAttribute('href', href);
    }
  } else if (tag === 'img') {
    const src = node.getAttribute('src');
    if (!src || !uriSafePattern.test(src.trim())) {
      return null;
    }
    cleanElement.setAttribute('src', src);
    const alt = node.getAttribute('alt');
    if (alt) {
      cleanElement.setAttribute('alt', alt);
    }
  }

  node.childNodes.forEach((child) => {
    const sanitizedChild = sanitizeNode(child, doc);
    if (sanitizedChild) {
      cleanElement.appendChild(sanitizedChild);
    }
  });

  return cleanElement;
}

function collectSanitizedChildren(parent, doc) {
  const nodes = [];
  parent.childNodes.forEach((child) => {
    const sanitized = sanitizeNode(child, doc);
    if (!sanitized) return;

    if (sanitized.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      nodes.push(...Array.from(sanitized.childNodes));
    } else {
      nodes.push(sanitized);
    }
  });
  return nodes;
}

function extractReasoningSections(raw) {
  const reasoningSegments = [];
  const visibleText = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, content) => {
    reasoningSegments.push(content);
    return '';
  });
  return { visibleText, reasoningSegments };
}

function parseAnswerContent(raw) {
  const fallbackText = 'Empty response';
  if (!raw) {
    return {
      visibleNodes: [document.createTextNode(fallbackText)],
      reasoningNodes: [],
    };
  }

  try {
    const { visibleText, reasoningSegments } = extractReasoningSections(raw);
    const parser = new DOMParser();
    const html = typeof snarkdown === 'function' ? snarkdown(visibleText) : visibleText;
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const container = doc.body.firstElementChild || doc.body;

    sanitizeFragment(container);

    const reasoningContainer = doc.createElement('div');
    reasoningSegments.forEach((segment) => {
      const reasoningHtml = typeof snarkdown === 'function' ? snarkdown(segment) : segment;
      const temp = doc.createElement('div');
      temp.innerHTML = reasoningHtml;
      sanitizeFragment(temp);

      const wrapper = doc.createElement('div');
      collectSanitizedChildren(temp, doc).forEach((child) => {
        wrapper.appendChild(child);
      });

      reasoningContainer.appendChild(wrapper);
    });

    const visibleNodes = collectSanitizedChildren(container, doc);
    const reasoningNodes = collectSanitizedChildren(reasoningContainer, doc);

    if (!visibleNodes.length) {
      visibleNodes.push(doc.createTextNode(fallbackText));
    }

    return { visibleNodes, reasoningNodes };
  } catch (err) {
    console.error('Failed to parse answer content', err);
    return {
      visibleNodes: [document.createTextNode(fallbackText)],
      reasoningNodes: [],
    };
  }
}

let conversation = null;
let port;
let streamingTarget = null;
let sending = false;

function showStatus(message, isError = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(isError));
}

function setSendingState(isSending) {
  sending = isSending;
  const prompt = $('prompt');
  const sendBtn = $('send');
  if (prompt) prompt.disabled = isSending;
  if (sendBtn) sendBtn.disabled = isSending;
}

function renderMeta(data) {
  const meta = $('meta');
  if (!meta) return;

  if (!data) {
    meta.textContent = 'No previous response saved yet.';
    return;
  }

  const rows = [
    `<div><strong>Source:</strong> ${data.source || 'N/A'}</div>`,
    `<div><strong>URL:</strong> ${data.url || 'N/A'}</div>`,
    `<div><strong>Model:</strong> ${data.provider || 'openai'} / ${data.model || 'unknown'}</div>`,
    `<div><strong>Updated:</strong> ${formatDate(data.updatedAt || data.createdAt)}</div>`
  ];

  meta.innerHTML = rows.join('');
}

function buildAssistantContent(answer) {
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-content';

  const { visibleNodes, reasoningNodes } = parseAnswerContent(answer);

  const visibleSection = document.createElement('div');
  visibleSection.className = 'answer-visible';
  visibleNodes.forEach((node) => visibleSection.appendChild(document.importNode(node, true)));
  wrapper.appendChild(visibleSection);

  if (reasoningNodes.length) {
    const toggle = document.createElement('button');
    toggle.className = 'reasoning-toggle';
    toggle.textContent = 'Show reasoning';

    const reasoningSection = document.createElement('div');
    reasoningSection.className = 'reasoning hidden';

    const label = document.createElement('p');
    label.className = 'reasoning-label';
    label.textContent = 'Reasoning';
    reasoningSection.appendChild(label);

    reasoningNodes.forEach((node) => reasoningSection.appendChild(document.importNode(node, true)));

    toggle.addEventListener('click', () => {
      const isHidden = reasoningSection.classList.toggle('hidden');
      toggle.textContent = isHidden ? 'Show reasoning' : 'Hide reasoning';
    });

    wrapper.append(toggle, reasoningSection);
  }

  return wrapper;
}

function renderConversation(data) {
  conversation = data;
  const container = $('conversation');
  if (!container) return;

  container.textContent = '';
  streamingTarget = null;

  renderMeta(data);

  if (!data) return;

  const messages = data.messages || [];
  messages
    .filter((msg) => msg.role !== 'system')
    .forEach((msg) => {
      const messageEl = document.createElement('article');
      messageEl.className = `message ${msg.role}`;

      const label = document.createElement('p');
      label.className = 'label';
      label.textContent = msg.role === 'assistant' ? 'Assistant' : 'You';
      messageEl.appendChild(label);

      const body = document.createElement('div');
      body.className = 'message-body';

      if (msg.role === 'assistant') {
        body.appendChild(buildAssistantContent(msg.content));
      } else {
        body.textContent = msg.content;
      }

      messageEl.appendChild(body);
      container.appendChild(messageEl);
    });
}

function appendUserMessage(prompt) {
  const container = $('conversation');
  if (!container) return;

  const messageEl = document.createElement('article');
  messageEl.className = 'message user';

  const label = document.createElement('p');
  label.className = 'label';
  label.textContent = 'You';
  messageEl.appendChild(label);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = prompt;
  messageEl.appendChild(body);

  container.appendChild(messageEl);
  messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function ensureStreamingAssistant() {
  if (streamingTarget) return streamingTarget;

  const container = $('conversation');
  if (!container) return null;

  const messageEl = document.createElement('article');
  messageEl.className = 'message assistant';

  const label = document.createElement('p');
  label.className = 'label';
  label.textContent = 'Assistant';
  messageEl.appendChild(label);

  const body = document.createElement('div');
  body.className = 'message-body';
  const textNode = document.createTextNode('');
  body.appendChild(textNode);

  messageEl.appendChild(body);
  container.appendChild(messageEl);
  messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });

  streamingTarget = { container: messageEl, textNode };
  return streamingTarget;
}

function handleToken(chunk) {
  const target = ensureStreamingAssistant();
  if (!target) return;
  target.textNode.textContent += chunk;
}

function requestConversation() {
  port?.postMessage({ type: 'get-conversation' });
}

function handleFollowUp(evt) {
  evt.preventDefault();
  if (sending) return;

  const prompt = $('prompt').value.trim();
  if (!prompt) {
    showStatus('Enter a follow-up prompt.', true);
    return;
  }

  if (!conversation) {
    showStatus('No conversation found to continue.', true);
    return;
  }

  setSendingState(true);
  showStatus('Sending follow-up...');
  $('prompt').value = '';
  appendUserMessage(prompt);
  port?.postMessage({ type: 'followup', prompt });
}

function initPort() {
  port = api.runtime.connect({ name: 'response-view' });
  port.onMessage.addListener((message) => {
    if (message.type === 'conversation') {
      setSendingState(false);
      showStatus('');
      renderConversation(message.conversation);
    }

    if (message.type === 'token') {
      handleToken(message.chunk);
      showStatus('Receiving response...');
    }

    if (message.type === 'error') {
      setSendingState(false);
      showStatus(message.message || 'An error occurred', true);
    }
  });
}

(function init() {
  $('refresh').addEventListener('click', requestConversation);
  $('followup-form').addEventListener('submit', handleFollowUp);

  initPort();
  requestConversation();
})();
