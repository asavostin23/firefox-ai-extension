const api = typeof browser !== 'undefined' ? browser : chrome;
const defaults = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 512
};

function getStoredSettings() {
  return new Promise((resolve, reject) => {
    api.storage.local.get(defaults, (items) => {
      if (api.runtime.lastError) {
        reject(api.runtime.lastError);
        return;
      }

      resolve({ ...defaults, ...items });
    });
  });
}

function $(id) {
  return document.getElementById(id);
}

function showStatus(message, isError = false) {
  const el = $('status');
  el.textContent = message;
  el.style.color = isError ? '#fecdd3' : '#a7f3d0';
}

async function loadSettings() {
  try {
    const settings = await getStoredSettings();
    $('provider').value = settings.provider;
    $('apiKey').value = settings.apiKey || '';
    $('baseUrl').value = settings.baseUrl;
    $('model').value = settings.model;
    $('temperature').value = settings.temperature;
    $('maxTokens').value = settings.maxTokens;
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

function parseNumberInput(id, fallback) {
  const input = $(id);
  const parsed = Number.parseFloat(input.value);
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);

  const value = Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;

  input.value = value;
  return value;
}

async function saveSettings(evt) {
  evt.preventDefault();

  try {
    const existing = await getStoredSettings();
    const payload = {
      provider: $('provider').value,
      apiKey: $('apiKey').value.trim(),
      baseUrl: $('baseUrl').value.trim(),
      model: $('model').value.trim(),
      temperature: parseNumberInput('temperature', existing.temperature),
      maxTokens: parseNumberInput('maxTokens', existing.maxTokens)
    };

    api.storage.local.set(payload, () => {
      if (api.runtime.lastError) {
        showStatus(api.runtime.lastError.message, true);
      } else {
        showStatus('Saved. Use the context menu to send prompts.');
      }
    });
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

(function init() {
  loadSettings();
  $('settings-form').addEventListener('submit', saveSettings);
})();
