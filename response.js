const api = typeof browser !== 'undefined' ? browser : chrome;

function $(id) {
  return document.getElementById(id);
}

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
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

  answer.textContent = result.answer || 'Empty response';
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
