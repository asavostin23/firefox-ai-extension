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
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
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
let streamingState = { buffer: '', inThink: false };
let streamingPlaceholderActive = false;
let followUpEnabled = false;

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
  if (prompt) prompt.disabled = isSending || !followUpEnabled;
  if (sendBtn) sendBtn.disabled = isSending || !followUpEnabled;
}

function setFollowUpEnabled(isEnabled) {
  followUpEnabled = isEnabled;
  const prompt = $('prompt');
  const sendBtn = $('send');
  if (prompt) prompt.disabled = sending || !followUpEnabled;
  if (sendBtn) sendBtn.disabled = sending || !followUpEnabled;
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

  wrapper.appendChild(visibleSection);

  return wrapper;
}

function renderConversation(data) {
  conversation = data;
  const container = $('conversation');
  if (!container) return;

  container.textContent = '';
  streamingTarget = null;
  streamingState = { buffer: '', inThink: false };
  streamingPlaceholderActive = false;

  renderMeta(data);
  setFollowUpEnabled(Boolean(data));

  if (!data) {
    renderEmptyConversation();
    showStatus('');
    return;
  }

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
        body.textContent = msg.displayText || msg.content;
      }

      messageEl.appendChild(body);
      container.appendChild(messageEl);
    });

  const hasAssistantMessage = messages.some((msg) => msg.role === 'assistant');
  const hasUserMessage = messages.some((msg) => msg.role === 'user');

  if (!hasAssistantMessage && hasUserMessage) {
    const target = ensureStreamingAssistant();
    if (target && !target.textNode.textContent) {
      target.textNode.textContent = 'Thinking…';
      streamingPlaceholderActive = true;
    }
    showStatus('Thinking…');
  } else {
    showStatus('');
  }
}

function renderEmptyConversation() {
  const container = $('conversation');
  if (!container) return;

  const empty = document.createElement('article');
  empty.className = 'empty-state';

  const title = document.createElement('h2');
  title.textContent = 'Ask about this page';
  empty.appendChild(title);

  const body = document.createElement('p');
  body.textContent = 'Start by summarizing the page you are viewing.';
  empty.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'empty-actions';

  const summarizeBtn = document.createElement('button');
  summarizeBtn.id = 'summarize';
  summarizeBtn.textContent = 'Summarize';
  summarizeBtn.addEventListener('click', handleSummarizePage);
  actions.appendChild(summarizeBtn);

  empty.appendChild(actions);
  container.appendChild(empty);
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

  const assistantContent = document.createElement('div');
  assistantContent.className = 'assistant-content';

  const visibleSection = document.createElement('div');
  visibleSection.className = 'answer-visible';
  const textNode = document.createTextNode('');
  visibleSection.appendChild(textNode);
  assistantContent.appendChild(visibleSection);

  body.appendChild(assistantContent);

  messageEl.appendChild(body);
  container.appendChild(messageEl);
  messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });

  streamingTarget = { container: messageEl, textNode, assistantContent, visibleSection };
  return streamingTarget;
}

function ensureReasoningUI(target) {
  if (target.reasoningSection) return;

  const toggle = document.createElement('button');
  toggle.className = 'reasoning-toggle';
  toggle.textContent = 'Show reasoning';

  const reasoningSection = document.createElement('div');
  reasoningSection.className = 'reasoning hidden';

  const label = document.createElement('p');
  label.className = 'reasoning-label';
  label.textContent = 'Reasoning';
  reasoningSection.appendChild(label);

  const placeholder = document.createElement('p');
  placeholder.className = 'reasoning-placeholder';
  placeholder.textContent = 'Thinking…';
  reasoningSection.appendChild(placeholder);

  const reasoningContent = document.createElement('div');
  reasoningContent.className = 'reasoning-stream';
  reasoningSection.appendChild(reasoningContent);

  toggle.addEventListener('click', () => {
    const isHidden = reasoningSection.classList.toggle('hidden');
    toggle.textContent = isHidden ? 'Show reasoning' : 'Hide reasoning';
  });

  const anchor = target.visibleSection || target.assistantContent.firstChild;
  if (anchor) {
    target.assistantContent.insertBefore(reasoningSection, anchor);
    target.assistantContent.insertBefore(toggle, reasoningSection);
  } else {
    target.assistantContent.append(toggle, reasoningSection);
  }

  target.reasoningSection = reasoningSection;
  target.reasoningContent = reasoningContent;
  target.reasoningToggle = toggle;
}

function appendReasoningChunk(chunk, target) {
  ensureReasoningUI(target);
  if (!chunk) return;
  const textNode = document.createTextNode(chunk);
  target.reasoningContent.appendChild(textNode);
}

function handleToken(chunk) {
  const target = ensureStreamingAssistant();
  if (!target) return;

  if (streamingPlaceholderActive) {
    target.textNode.textContent = '';
    streamingPlaceholderActive = false;
  }

  const THINK_OPEN = '<think>';
  const THINK_CLOSE = '</think>';
  streamingState.buffer += chunk;

  while (streamingState.buffer.length) {
    const lowerBuffer = streamingState.buffer.toLowerCase();

    if (!streamingState.inThink) {
      const openIdx = lowerBuffer.indexOf(THINK_OPEN);
      const closeIdx = lowerBuffer.indexOf(THINK_CLOSE);

      if (openIdx === -1 && closeIdx === -1) {
        const lastLt = lowerBuffer.lastIndexOf('<');
        if (lastLt !== -1) {
          const fragment = lowerBuffer.slice(lastLt);
          if (THINK_OPEN.startsWith(fragment) || THINK_CLOSE.startsWith(fragment)) {
            target.textNode.textContent += streamingState.buffer.slice(0, lastLt);
            streamingState.buffer = streamingState.buffer.slice(lastLt);
            break;
          }
        }

        target.textNode.textContent += streamingState.buffer;
        streamingState.buffer = '';
        break;
      }

      if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
        const visible = streamingState.buffer.slice(0, closeIdx + THINK_CLOSE.length);
        target.textNode.textContent += visible;
        streamingState.buffer = streamingState.buffer.slice(closeIdx + THINK_CLOSE.length);
        continue;
      }

      if (openIdx !== -1) {
        const before = streamingState.buffer.slice(0, openIdx);
        target.textNode.textContent += before;
        streamingState.buffer = streamingState.buffer.slice(openIdx + THINK_OPEN.length);
        streamingState.inThink = true;
        ensureReasoningUI(target);
        continue;
      }

      target.textNode.textContent += streamingState.buffer;
      streamingState.buffer = '';
      break;
    }

    const closeIdx = lowerBuffer.indexOf(THINK_CLOSE);
    if (closeIdx === -1) {
      const lastLt = lowerBuffer.lastIndexOf('<');
      if (lastLt !== -1) {
        const fragment = lowerBuffer.slice(lastLt);
        if (THINK_CLOSE.startsWith(fragment)) {
          appendReasoningChunk(streamingState.buffer.slice(0, lastLt), target);
          streamingState.buffer = streamingState.buffer.slice(lastLt);
          break;
        }
      }

      appendReasoningChunk(streamingState.buffer, target);
      streamingState.buffer = '';
      break;
    }

    const reasoningChunk = streamingState.buffer.slice(0, closeIdx);
    appendReasoningChunk(reasoningChunk, target);
    streamingState.buffer = streamingState.buffer.slice(closeIdx + THINK_CLOSE.length);
    streamingState.inThink = false;
  }
}

function requestConversation() {
  port?.postMessage({ type: 'get-conversation' });
}

function clearConversation() {
  conversation = null;
  renderMeta(null);

  const container = $('conversation');
  if (container) container.textContent = '';

  streamingTarget = null;
  streamingState = { buffer: '', inThink: false };
  streamingPlaceholderActive = false;

  setSendingState(false);
  setFollowUpEnabled(false);
  showStatus('Conversation cleared.');

  port?.postMessage({ type: 'clear-conversation' });
}

function handleFollowUp(evt) {
  evt.preventDefault();
  if (sending) return;

  const prompt = $('prompt').value.trim();
  if (!prompt) {
    showStatus('Enter a follow-up prompt.', true);
    return;
  }

  if (!followUpEnabled) {
    showStatus('Start a new conversation to ask follow-ups.', true);
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

function handleSummarizePage(evt) {
  evt?.preventDefault?.();
  if (sending) return;

  setFollowUpEnabled(false);
  setSendingState(true);
  showStatus('Summarizing page...');
  port?.postMessage({ type: 'summarize-page' });
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
  setFollowUpEnabled(false);
  const clearButton = $('clear');
  if (clearButton) {
    clearButton.addEventListener('click', clearConversation);
  }
  $('followup-form').addEventListener('submit', handleFollowUp);

  initPort();
  requestConversation();
})();
