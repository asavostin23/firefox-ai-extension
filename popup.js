const api = typeof browser !== 'undefined' ? browser : chrome;
const defaults = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 512
};

function $(id) {
  return document.getElementById(id);
}

function showStatus(message, isError = false) {
  const el = $('status');
  el.textContent = message;
  el.style.color = isError ? '#fecdd3' : '#a7f3d0';
}

function loadSettings() {
  api.storage.local.get(defaults, (items) => {
    $('provider').value = items.provider || defaults.provider;
    $('apiKey').value = items.apiKey || '';
    $('baseUrl').value = items.baseUrl || defaults.baseUrl;
    $('model').value = items.model || defaults.model;
    $('temperature').value = items.temperature ?? defaults.temperature;
    $('maxTokens').value = items.maxTokens ?? defaults.maxTokens;
  });
}

function saveSettings(evt) {
  evt.preventDefault();
  const payload = {
    provider: $('provider').value,
    apiKey: $('apiKey').value.trim(),
    baseUrl: $('baseUrl').value.trim(),
    model: $('model').value.trim(),
    temperature: Number($('temperature').value),
    maxTokens: Number($('maxTokens').value)
  };

  api.storage.local.set(payload, () => {
    if (api.runtime.lastError) {
      showStatus(api.runtime.lastError.message, true);
    } else {
      showStatus('Saved. Use the context menu to send prompts.');
    }
  });
}

(function init() {
  loadSettings();
  $('settings-form').addEventListener('submit', saveSettings);
})();
