const api = typeof browser !== 'undefined' ? browser : chrome;
const defaults = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 4096
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

function validateAndDisplayStatus() {
  const apiKeyValue = $('apiKey').value.trim();
  const maxTokensInput = $('maxTokens');
  const maxTokensValue = Number.parseFloat(maxTokensInput.value);
  const min = maxTokensInput.min === '' ? -Infinity : Number(maxTokensInput.min);
  const max = maxTokensInput.max === '' ? Infinity : Number(maxTokensInput.max);

  if (!apiKeyValue) {
    showStatus('Enter an API key to enable requests.', true);
    return false;
  }

  if (!Number.isFinite(maxTokensValue) || maxTokensValue < min || maxTokensValue > max) {
    showStatus(`Max tokens must be between ${min} and ${max}.`, true);
    return false;
  }

  showStatus('Settings ready. Use the context menu to send prompts.');
  return true;
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

    validateAndDisplayStatus();
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

    validateAndDisplayStatus();
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
