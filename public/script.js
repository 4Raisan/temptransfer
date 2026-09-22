/**
 * Temp-Transfer - Community Synchronized Text Transfer
 * Real-time community shared clipboard with 24-hour auto-clear
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const STORAGE_KEY = 'temptransfer_community_cache';
  const THEME_KEY = 'temptransfer_theme';
  const EXPIRATION_MS = 24 * 60 * 60 * 1000; // Exactly 24 hours
  const POLL_INTERVAL = 3000; // Poll community updates every 3 seconds

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
  let communityTexts = [];
  let isFetching = false;

  // --- Local Cache Helpers ---
  function getCachedTexts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? purgeExpired(list) : [];
    } catch (e) {
      return [];
    }
  }

  function setCachedTexts(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function purgeExpired(list) {
    const now = Date.now();
    return list.filter(item => {
      const expires = item.expiresAt || (item.createdAt + EXPIRATION_MS);
      return expires > now;
    });
  }

  // --- Community API Sync ---

  async function fetchCommunityTexts(silent = true) {
    if (isFetching) return;
    isFetching = true;
    try {
      const res = await fetch(`/api/texts?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.texts)) {
          const freshTexts = purgeExpired(data.texts);
          
          // Check if data actually changed before re-rendering
          const hasChanged = JSON.stringify(freshTexts) !== JSON.stringify(communityTexts);
          if (hasChanged) {
            communityTexts = freshTexts;
            setCachedTexts(freshTexts);
            renderTexts();
          }
        }
      }
    } catch (err) {
      if (!silent) console.warn('Could not reach community server:', err.message);
    } finally {
      isFetching = false;
    }
  }

  async function postNewText(content) {
    const now = Date.now();
    const tempId = 'temp_' + now;
    const optimisticItem = {
      id: tempId,
      text: content,
      createdAt: now,
      expiresAt: now + EXPIRATION_MS
    };

    // Optimistic UI update
    communityTexts.unshift(optimisticItem);
    renderTexts();
    showToast('Adding to community...', 'success');

    try {
      const res = await fetch('/api/texts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.texts) {
          communityTexts = purgeExpired(data.texts);
          setCachedTexts(communityTexts);
          renderTexts();
          showToast('Added! Visible to everyone across devices', 'success');
          return;
        }
      }
      throw new Error('Server returned error');
    } catch (e) {
      // Keep optimistic item in local cache even if server momentarily hiccups
      setCachedTexts(communityTexts);
      showToast('Saved locally, will sync when reconnected', 'warning');
    }
  }

  async function deleteTextItem(id) {
    // Optimistic remove
    communityTexts = communityTexts.filter(t => t.id !== id);
    setCachedTexts(communityTexts);
    renderTexts();
    showToast('Text removed', 'success');

    try {
      await fetch(`/api/texts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      fetchCommunityTexts(true);
    } catch (e) {
      console.error('Delete sync failed:', e);
    }
  }

  async function clearAllTexts() {
    if (communityTexts.length === 0) return;
    if (!confirm(`Are you sure you want to clear all ${communityTexts.length} community text snippet(s)?`)) return;

    communityTexts = [];
    setCachedTexts([]);
    renderTexts();
    showToast('All community texts cleared', 'success');

    try {
      await fetch('/api/texts', { method: 'DELETE' });
      fetchCommunityTexts(true);
    } catch (e) {
      console.error('Clear all sync failed:', e);
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
      return `${hours}h ${minutes}m left`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s left`;
    } else {
      return `${seconds}s left`;
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

  // --- Add Text Button ---
  function handleAddText() {
    const raw = textInput.value;
    const content = raw.trim();

    if (!content) {
      showToast('Please type or paste some text first', 'danger');
      textInput.focus();
      return;
    }

    postNewText(content);

    // Clear input box
    textInput.value = '';
    updateInputStats();
    textInput.focus();
  }

  // --- Clear Input Box Button ---
  function handleClearInput() {
    if (!textInput.value) return;
    textInput.value = '';
    updateInputStats();
    showToast('Input box cleared', 'success');
    textInput.focus();
  }

  // --- Update Statistics ---
  function updateInputStats() {
    const val = textInput.value;
    const charCount = val.length;
    const lines = val ? val.split('\n').length : 0;
    textStats.textContent = `${charCount} char${charCount === 1 ? '' : 's'} • ${lines} line${lines === 1 ? '' : 's'}`;
  }

  // --- Render Text Cards ---
  function renderTexts() {
    const valid = purgeExpired(communityTexts);
    const totalCount = valid.length;
    textCountBadge.textContent = totalCount;

    if (totalCount === 0) {
      emptyState.style.display = 'flex';
      textList.innerHTML = '';
      sectionActions.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    sectionActions.style.display = 'flex';

    let filtered = valid;
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      filtered = valid.filter(item => item.text.toLowerCase().includes(q));
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
            <span class="card-expiry-badge ${statusClass}" title="Auto-deletes for everyone in 24 hours">
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
      communityTexts = purgeExpired(communityTexts);
      renderTexts();
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

  // --- Event Delegation ---
  textList.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;

    const action = target.getAttribute('data-action');
    const card = target.closest('.text-card');
    if (!card) return;

    const id = card.getAttribute('data-id');
    const item = communityTexts.find(t => t.id === id);
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleAddText();
    }
  });

  addBtn.addEventListener('click', handleAddText);
  clearInputBtn.addEventListener('click', handleClearInput);

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
          showToast('Clipboard read not supported', 'danger');
        }
      } catch (err) {
        showToast('Please press Ctrl+V to paste', 'danger');
      }
    });
  }

  searchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.trim();
    renderTexts();
  });

  clearAllBtn.addEventListener('click', clearAllTexts);

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

  // --- Init ---
  initTheme();
  communityTexts = getCachedTexts();
  renderTexts();
  updateInputStats();

  // Initial fetch from community backend
  fetchCommunityTexts(false);

  // Real-time polling: Every 3 seconds check for updates from other users/devices
  setInterval(() => fetchCommunityTexts(true), POLL_INTERVAL);

  // Update live countdown timers every second
  setInterval(updateCountdowns, 1000);

  // Refresh immediately when returning to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchCommunityTexts(true);
    }
  });

})();
