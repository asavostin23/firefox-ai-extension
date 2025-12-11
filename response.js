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
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'a',
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

function parseAnswerContent(raw) {
  const fallbackText = 'Empty response';
  if (!raw) {
    return {
      visibleNodes: [document.createTextNode(fallbackText)],
      reasoningNodes: [],
    };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
    const container = doc.body.firstElementChild || doc.body;

    sanitizeFragment(container);

    const reasoningContainer = doc.createElement('div');
    container.querySelectorAll('think').forEach((node) => {
      sanitizeFragment(node);
      const wrapper = doc.createElement('div');
      collectSanitizedChildren(node, doc).forEach((child) => {
        wrapper.appendChild(child);
      });
      reasoningContainer.appendChild(wrapper);
      node.remove();
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

function render(result) {
  const meta = $('meta');
  const answer = $('answer');
  if (!result) {
    meta.textContent = 'No previous response saved yet.';
    answer.textContent = '';
    return;
  }
  meta.innerHTML = `
    <div><strong>Source:</strong> ${result.source}</div>
    <div><strong>URL:</strong> ${result.url || 'N/A'}</div>
    <div><strong>Asked:</strong> ${formatDate(result.createdAt)}</div>
    ${result.completedAt ? `<div><strong>Updated:</strong> ${formatDate(result.completedAt)}</div>` : ''}
  `;

  const { visibleNodes, reasoningNodes } = parseAnswerContent(result.answer);

  answer.textContent = '';

  const status = result.status || 'complete';

  if (status === 'loading') {
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'loading';

    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    loadingContainer.appendChild(spinner);

    const loadingText = document.createElement('p');
    loadingText.className = 'loading-text';
    loadingText.textContent = 'Waiting for the model to respond...';
    loadingContainer.appendChild(loadingText);

    answer.appendChild(loadingContainer);

    if (result.answer) {
      const partialLabel = document.createElement('p');
      partialLabel.className = 'partial-label';
      partialLabel.textContent = 'Partial response';
      answer.appendChild(partialLabel);
    } else {
      return;
    }
  }

  if (status === 'error') {
    const errorBox = document.createElement('div');
    errorBox.className = 'error-box';
    errorBox.textContent = result.answer || 'An error occurred while fetching the response.';
    answer.appendChild(errorBox);
    return;
  }

  const visibleSection = document.createElement('div');
  visibleSection.className = 'answer-visible';
  visibleNodes.forEach((node) => {
    visibleSection.appendChild(document.importNode(node, true));
  });

  answer.appendChild(visibleSection);

  if (reasoningNodes.length) {
    const toggle = document.createElement('button');
    toggle.id = 'toggle-reasoning';
    toggle.className = 'reasoning-toggle';
    toggle.textContent = 'Show reasoning';

    const reasoningSection = document.createElement('div');
    reasoningSection.id = 'reasoning';
    reasoningSection.className = 'reasoning hidden';

    const label = document.createElement('p');
    label.className = 'reasoning-label';
    label.textContent = 'Reasoning';
    reasoningSection.appendChild(label);

    reasoningNodes.forEach((node) => {
      reasoningSection.appendChild(document.importNode(node, true));
    });

    toggle.addEventListener('click', () => {
      const isHidden = reasoningSection.classList.toggle('hidden');
      toggle.textContent = isHidden ? 'Show reasoning' : 'Hide reasoning';
    });

    answer.append(toggle, reasoningSection);
  }
}

function load() {
  api.storage.local.get(['lastResult'], ({ lastResult }) => {
    render(lastResult);
  });
}

(function init() {
  $('refresh').addEventListener('click', load);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.lastResult) {
      render(changes.lastResult.newValue);
    }
  });
  load();
})();
