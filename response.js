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
      while (node.firstChild) {
        wrapper.appendChild(node.firstChild);
      }
      reasoningContainer.appendChild(wrapper);
      node.remove();
    });

    const visibleNodes = Array.from(container.childNodes);
    const reasoningNodes = Array.from(reasoningContainer.childNodes);

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
  `;

  const { visibleNodes, reasoningNodes } = parseAnswerContent(result.answer);

  answer.textContent = '';

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
  load();
})();
