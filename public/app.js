/**
 * Temp-Transfer - Main Application Logic
 * Clean, lightweight, zero-bloat temporary text transfer with 24-hour auto-clear
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const STORAGE_KEY = 'temptransfer_texts_v1';
  const THEME_KEY = 'temptransfer_theme';
  const EXPIRATION_MS = 24 * 60 * 60 * 1000; // Exactly 24 hours in milliseconds

  // --- DOM Elements ---
  const textInput = document.getElementById('textInput');
  const textStats = document.getElementById('textStats');
  const addBtn = document.getElementById('addBtn');
  const clearInputBtn = document.getElementById('clearInputBtn');
  const pasteBtn = document.getElementById('pasteBtn');
  const textList = document.getElementById('textList');
  const emptyState = document.getElementById('emptyState');
  const textCountBadge = document.getElementById('textCountBadge');
  const sectionActions = document.getElementById('sectionActions');
  const searchInput = document.getElementById('searchInput');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const themeToggle = document.getElementById('themeToggle');
  const toastContainer = document.getElementById('toastContainer');
  const qrModal = document.getElementById('qrModal');
  const qrContainer = document.getElementById('qrContainer');
  const closeModalBtn = document.getElementById('closeModalBtn');

  let currentSearchQuery = '';

  // --- Storage & Expiration Logic ---

  /**
   * Get all texts from localStorage and automatically purge expired ones (> 24h old)
   */
  function getTexts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];

      const now = Date.now();
      const valid = list.filter(item => {
        // Must have created and expiration timestamp
        const expiresAt = item.expiresAt || (item.createdAt + EXPIRATION_MS);
        return expiresAt > now;
      });

      // If any expired items were filtered out, save back immediately
      if (valid.length !== list.length) {
        saveTextsToStorage(valid);
      }

      return valid;
    } catch (e) {
      console.error('Failed to read texts from storage:', e);
      return [];
    }
  }

  /**
   * Save array to localStorage
   */
  function saveTextsToStorage(texts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(texts));
    } catch (e) {
      console.error('Failed to save texts to storage:', e);
      showToast('Storage full or error saving text', 'danger');
    }
  }

  /**
   * Active sweeper that runs periodically to delete texts older than 24 hours
   */
  function purgeExpiredTexts() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || list.length === 0) return;

      const now = Date.now();
      const valid = list.filter(item => {
        const expiresAt = item.expiresAt || (item.createdAt + EXPIRATION_MS);
        return expiresAt > now;
      });

      const expiredCount = list.length - valid.length;
      if (expiredCount > 0) {
        saveTextsToStorage(valid);
        renderTexts();
        showToast(`${expiredCount} text${expiredCount > 1 ? 's' : ''} auto-cleared (24h reached)`, 'danger');
      }
    } catch (e) {
      console.error('Error during auto-purge:', e);
    }
  }

  // --- UI Helpers ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function linkify(str) {
    const escaped = escapeHtml(str);
    // Convert http/https links to clickable tags safely
    const urlPattern = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Expired';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s remaining`;
    } else {
      return `${seconds}s remaining`;
    }
  }

  function getExpiryStatusClass(ms) {
    const oneHour = 60 * 60 * 1000;
    const sixHours = 6 * oneHour;
    if (ms > sixHours) return 'expiry-safe';
    if (ms > oneHour) return 'expiry-warning';
    return 'expiry-danger';
  }

  function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const sec = Math.floor(diff / 1000);
    if (sec < 45) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hours = Math.floor(min / 60);
    return `${hours}h ago`;
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--success-color)"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--danger-color)"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  // --- Copy Directly to Clipboard ---
  function copyTextToClipboard(text, btnElement) {
    if (!text) return;

    const onSuccess = () => {
      showToast('Copied to clipboard!', 'success');
      if (btnElement) {
        const originalHtml = btnElement.innerHTML;
        btnElement.classList.add('copied');
        btnElement.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Copied!
        `;

        setTimeout(() => {
          btnElement.classList.remove('copied');
          btnElement.innerHTML = originalHtml;
        }, 2000);
      }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        fallbackCopy(text, onSuccess);
      });
    } else {
      fallbackCopy(text, onSuccess);
    }
  }

  function fallbackCopy(text, onSuccess) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      onSuccess();
    } catch (err) {
      showToast('Unable to copy text directly', 'danger');
    }
    document.body.removeChild(textArea);
  }

  // --- Add Text Action ---
  function handleAddText() {
    const raw = textInput.value;
    const content = raw.trim();

    if (!content) {
      showToast('Please type or paste some text first', 'danger');
      textInput.focus();
      return;
    }

    const now = Date.now();
    const newItem = {
      id: 'tt_' + now.toString(36) + Math.random().toString(36).substr(2, 6),
      text: content,
      createdAt: now,
      expiresAt: now + EXPIRATION_MS
    };

    const list = getTexts();
    list.unshift(newItem);
    saveTextsToStorage(list);

    // Clear input box after adding
    textInput.value = '';
    updateInputStats();

    renderTexts();
    showToast('Text added! Auto-clears in 24 hours', 'success');
    textInput.focus();
  }

  // --- Clear Text Input Box Action ---
  function handleClearInput() {
    if (!textInput.value) return;
    textInput.value = '';
    updateInputStats();
    showToast('Input box cleared', 'success');
    textInput.focus();
  }

  // --- Delete Single Text Card ---
  function deleteTextItem(id) {
    const list = getTexts();
    const filtered = list.filter(item => item.id !== id);
    saveTextsToStorage(filtered);
    renderTexts();
    showToast('Text removed', 'success');
  }

  // --- Clear All Texts ---
  function handleClearAll() {
    const list = getTexts();
    if (list.length === 0) return;

    if (confirm(`Are you sure you want to clear all ${list.length} text snippet(s)?`)) {
      saveTextsToStorage([]);
      renderTexts();
      showToast('All texts cleared', 'success');
    }
  }

  // --- Update Input Box Statistics ---
  function updateInputStats() {
    const val = textInput.value;
    const charCount = val.length;
    const lines = val ? val.split('\n').length : 0;
    textStats.textContent = `${charCount} char${charCount === 1 ? '' : 's'} • ${lines} line${lines === 1 ? '' : 's'}`;
  }

  // --- Render Text Cards ---
  function renderTexts() {
    const texts = getTexts();
    const totalCount = texts.length;
    textCountBadge.textContent = totalCount;

    if (totalCount === 0) {
      emptyState.style.display = 'flex';
      textList.innerHTML = '';
      sectionActions.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    sectionActions.style.display = 'flex';

    // Apply search filter if active
    let filtered = texts;
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      filtered = texts.filter(item => item.text.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
      textList.innerHTML = `
        <div class="empty-state" style="padding: 2rem;">
          <p>No texts match "${escapeHtml(currentSearchQuery)}"</p>
        </div>
      `;
      return;
    }

    const now = Date.now();
    textList.innerHTML = filtered.map(item => {
      const remainingMs = Math.max(0, item.expiresAt - now);
      const expiryText = formatTimeRemaining(remainingMs);
      const statusClass = getExpiryStatusClass(remainingMs);
      const relativeTime = formatRelativeTime(item.createdAt);
      const exactTime = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const charCount = item.text.length;
      const lines = item.text.split('\n').length;

      return `
        <article class="text-card" data-id="${item.id}" data-expires="${item.expiresAt}">
          <div class="text-card-header">
            <div class="card-time" title="${new Date(item.createdAt).toLocaleString()}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span>Added ${relativeTime} (${exactTime})</span>
            </div>
            <span class="card-expiry-badge ${statusClass}" title="Will automatically delete when countdown reaches zero">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="6" x2="12" y2="12"></line>
              </svg>
              <span class="countdown-text">${expiryText}</span>
            </span>
          </div>

          <div class="text-card-body">
            <div class="card-text">${linkify(item.text)}</div>
          </div>

          <div class="text-card-footer">
            <div class="card-meta-info">
              ${charCount} char${charCount === 1 ? '' : 's'} &bull; ${lines} line${lines === 1 ? '' : 's'}
            </div>

            <div class="card-actions">
              <!-- Direct Copy Button -->
              <button class="btn-copy" data-action="copy" title="Copy text directly to clipboard">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy Text
              </button>

              <!-- QR Code Transfer Button -->
              <button class="btn-card-action" data-action="qr" title="Scan to open on phone">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                QR
              </button>

              <!-- Delete Single Button -->
              <button class="btn-card-action btn-card-danger" data-action="delete" title="Delete this text now">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  // --- Real-Time Countdown Update ---
  function updateCountdowns() {
    const cards = textList.querySelectorAll('.text-card');
    const now = Date.now();
    let hasExpired = false;

    cards.forEach(card => {
      const expiresAt = parseInt(card.getAttribute('data-expires'), 10);
      const remainingMs = expiresAt - now;

      if (remainingMs <= 0) {
        hasExpired = true;
      } else {
        const badge = card.querySelector('.card-expiry-badge');
        const textSpan = card.querySelector('.countdown-text');
        if (badge && textSpan) {
          textSpan.textContent = formatTimeRemaining(remainingMs);
          badge.className = `card-expiry-badge ${getExpiryStatusClass(remainingMs)}`;
        }
      }
    });

    if (hasExpired) {
      purgeExpiredTexts();
    }
  }

  // --- QR Code Modal ---
  function openQrModal(text) {
    if (!qrContainer) return;
    qrContainer.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(qrContainer, {
          text: text,
          width: 200,
          height: 200,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
        qrModal.classList.add('show');
        qrModal.setAttribute('aria-hidden', 'false');
      } catch (e) {
        console.error('QR code generation error:', e);
        showToast('Text too large for QR code', 'danger');
      }
    } else {
      showToast('QR code library not loaded', 'danger');
    }
  }

  function closeQrModal() {
    qrModal.classList.remove('show');
    qrModal.setAttribute('aria-hidden', 'true');
  }

  // --- Card Event Delegation (Copy, QR, Delete) ---
  textList.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;

    const action = target.getAttribute('data-action');
    const card = target.closest('.text-card');
    if (!card) return;

    const id = card.getAttribute('data-id');
    const texts = getTexts();
    const item = texts.find(t => t.id === id);
    if (!item) return;

    if (action === 'copy') {
      copyTextToClipboard(item.text, target);
    } else if (action === 'qr') {
      openQrModal(item.text);
    } else if (action === 'delete') {
      deleteTextItem(id);
    }
  });

  // --- Input & Keyboard Shortcuts ---
  textInput.addEventListener('input', updateInputStats);

  textInput.addEventListener('keydown', (e) => {
    // Ctrl + Enter or Cmd + Enter to add text
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleAddText();
    }
  });

  addBtn.addEventListener('click', handleAddText);
  clearInputBtn.addEventListener('click', handleClearInput);

  // Paste action
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const clipText = await navigator.clipboard.readText();
          if (clipText) {
            textInput.value = clipText;
            updateInputStats();
            showToast('Pasted from clipboard', 'success');
            textInput.focus();
          } else {
            showToast('Clipboard is empty', 'danger');
          }
        } else {
          showToast('Clipboard read not supported in this browser', 'danger');
        }
      } catch (err) {
        showToast('Please press Ctrl+V to paste', 'danger');
      }
    });
  }

  // Search input
  searchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.trim();
    renderTexts();
  });

  clearAllBtn.addEventListener('click', handleClearAll);

  // Modal events
  closeModalBtn.addEventListener('click', closeQrModal);
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && qrModal.classList.contains('show')) {
      closeQrModal();
    }
  });

  // --- Theme Toggle ---
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light') {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    }
  }

  themeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    document.body.classList.toggle('dark-theme', !isLight);
    localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
  });

  // --- Check URL Hash for shared text ---
  function checkUrlHash() {
    try {
      const hash = window.location.hash;
      if (hash && hash.startsWith('#text=')) {
        const decoded = decodeURIComponent(hash.substring(6));
        if (decoded) {
          textInput.value = decoded;
          updateInputStats();
          // Clean hash from address bar
          history.replaceState(null, '', window.location.pathname);
          showToast('Loaded shared text into input', 'success');
        }
      }
    } catch (e) {
      console.error('Error reading hash:', e);
    }
  }

  // --- Lifecycle & Timers ---
  initTheme();
  purgeExpiredTexts();
  renderTexts();
  updateInputStats();
  checkUrlHash();

  // Update countdown display every second
  setInterval(updateCountdowns, 1000);

  // Check and purge expired texts every 15 seconds
  setInterval(purgeExpiredTexts, 15000);

  // When tab becomes visible again, check for expired texts
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      purgeExpiredTexts();
      renderTexts();
    }
  });

})();
