/*! Snarkdown-like lightweight markdown parser (UMD bundle)
 * Adapted from the MIT-licensed Snarkdown project: https://github.com/developit/snarkdown
 */
(function (global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    (global || self).snarkdown = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const formatInline = (str) =>
    str
      .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return function snarkdown(src) {
    if (!src) return '';

    src = src.replace(/\r\n?/g, '\n');
    const out = [];
    let inCode = false;
    let codeBuffer = [];
    let listType = null;
    let listBuffer = [];

    const flushList = () => {
      if (!listType) return;
      out.push(`<${listType}>${listBuffer.join('')}</${listType}>`);
      listType = null;
      listBuffer = [];
    };

    const flushCode = () => {
      if (!inCode) return;
      out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
      inCode = false;
      codeBuffer = [];
    };

    src.split('\n').forEach((line) => {
      const fenceMatch = line.match(/^```/);
      if (fenceMatch) {
        if (inCode) {
          flushCode();
        } else {
          flushList();
          inCode = true;
        }
        return;
      }

      if (inCode) {
        codeBuffer.push(line);
        return;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushList();
        const level = headingMatch[1].length;
        out.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
        return;
      }

      const hrMatch = line.trim();
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(hrMatch)) {
        flushList();
        out.push('<hr>');
        return;
      }

      const quoteMatch = line.match(/^>\s?(.*)$/);
      if (quoteMatch) {
        flushList();
        out.push(`<blockquote>${formatInline(quoteMatch[1])}</blockquote>`);
        return;
      }

      const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ulMatch) {
        if (listType !== 'ul') {
          flushList();
          listType = 'ul';
        }
        listBuffer.push(`<li>${formatInline(ulMatch[1])}</li>`);
        return;
      }

      const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
      if (olMatch) {
        if (listType !== 'ol') {
          flushList();
          listType = 'ol';
        }
        listBuffer.push(`<li>${formatInline(olMatch[1])}</li>`);
        return;
      }

      flushList();

      if (line.trim()) {
        out.push(`<p>${formatInline(line.trim())}</p>`);
      }
    });

    flushCode();
    flushList();

    return out.join('');
  };
});
