/**
 * Private Bookmarks Vault for SongFetch / OmniFetch
 * Automatically binds to secret triggers and provides a private bookmark manager.
 */
(function() {
    const STORAGE_KEY = 'songfetch_private_bookmarks';
    const DEFAULT_BOOKMARKS = [
        {
            id: 'default_script_1',
            title: 'Google Apps Script Workspace',
            url: 'https://script.google.com/macros/s/AKfycbzen3BIx0pXRvhJuFHHiDswwpBP_YlvhRaaUaS_B-vbHeax0GcW1slsP6tpj5zWDkqhsA/exec',
            createdAt: Date.now()
        }
    ];

    function getBookmarks() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_BOOKMARKS));
                return DEFAULT_BOOKMARKS;
            }
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : DEFAULT_BOOKMARKS;
        } catch (e) {
            console.error('Failed to load private bookmarks', e);
            return DEFAULT_BOOKMARKS;
        }
    }

    function saveBookmarks(bookmarks) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
        } catch (e) {
            console.error('Failed to save private bookmarks', e);
        }
    }

    function createVaultModal() {
        if (document.getElementById('private-vault-modal')) return;

        // Add Styles
        const style = document.createElement('style');
        style.id = 'private-vault-styles';
        style.textContent = `
            #private-vault-modal {
                position: fixed;
                inset: 0;
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.25s;
                padding: 1rem;
                font-family: var(--font-primary, -apple-system, BlinkMacSystemFont, 'Outfit', 'Segoe UI', sans-serif);
                box-sizing: border-box;
            }

            #private-vault-modal.vault-open {
                opacity: 1;
                visibility: visible;
            }

            .vault-card {
                background: #0f111c;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 20px;
                width: 100%;
                max-width: 520px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 40px rgba(139, 92, 246, 0.2);
                transform: scale(0.94) translateY(10px);
                transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                overflow: hidden;
            }

            #private-vault-modal.vault-open .vault-card {
                transform: scale(1) translateY(0);
            }

            .vault-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 1.25rem 1.5rem;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(255, 255, 255, 0.02);
            }

            .vault-header-title {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                font-size: 1.15rem;
                font-weight: 700;
                color: #f3f4f6;
            }

            .vault-header-title svg {
                color: #a855f7;
            }

            .vault-badge {
                font-size: 0.7rem;
                font-weight: 600;
                padding: 2px 8px;
                background: rgba(168, 85, 247, 0.15);
                border: 1px solid rgba(168, 85, 247, 0.3);
                border-radius: 9999px;
                color: #c084fc;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .vault-close-btn {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #9ca3af;
                width: 32px;
                height: 32px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 1.1rem;
            }

            .vault-close-btn:hover {
                background: rgba(239, 68, 68, 0.2);
                border-color: rgba(239, 68, 68, 0.4);
                color: #f87171;
            }

            .vault-body {
                padding: 1.25rem 1.5rem;
                overflow-y: auto;
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 1.25rem;
            }

            /* Add Form */
            .vault-add-section {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 14px;
                padding: 1rem;
            }

            .vault-form {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            }

            .vault-input-group {
                display: flex;
                gap: 0.5rem;
            }

            @media (max-width: 480px) {
                .vault-input-group {
                    flex-direction: column;
                }
            }

            .vault-input {
                background: rgba(0, 0, 0, 0.35);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                padding: 0.65rem 0.85rem;
                color: #f3f4f6;
                font-size: 0.875rem;
                font-family: inherit;
                outline: none;
                width: 100%;
                box-sizing: border-box;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }

            .vault-input:focus {
                border-color: #a855f7;
                box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2);
            }

            .vault-add-btn {
                background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
                color: #ffffff;
                border: none;
                border-radius: 10px;
                padding: 0.65rem 1.2rem;
                font-weight: 600;
                font-size: 0.875rem;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.4rem;
                transition: opacity 0.2s, transform 0.1s;
                white-space: nowrap;
            }

            .vault-add-btn:hover {
                opacity: 0.92;
            }

            .vault-add-btn:active {
                transform: scale(0.98);
            }

            /* List Section */
            .vault-list-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 0.5rem;
                font-size: 0.85rem;
                color: #9ca3af;
            }

            .vault-list {
                display: flex;
                flex-direction: column;
                gap: 0.6rem;
                max-height: 280px;
                overflow-y: auto;
                padding-right: 4px;
            }

            .vault-list::-webkit-scrollbar {
                width: 6px;
            }
            .vault-list::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 9999px;
            }

            .vault-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.75rem 0.9rem;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.07);
                border-radius: 12px;
                transition: all 0.2s ease;
                gap: 0.75rem;
                text-decoration: none;
            }

            .vault-item:hover {
                background: rgba(255, 255, 255, 0.07);
                border-color: rgba(168, 85, 247, 0.4);
                transform: translateX(2px);
            }

            .vault-item-left {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                min-width: 0;
                flex: 1;
                cursor: pointer;
            }

            .vault-item-icon {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                background: rgba(168, 85, 247, 0.15);
                border: 1px solid rgba(168, 85, 247, 0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                overflow: hidden;
            }

            .vault-item-icon img {
                width: 18px;
                height: 18px;
                object-fit: contain;
            }

            .vault-item-details {
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .vault-item-name {
                font-size: 0.9rem;
                font-weight: 600;
                color: #f3f4f6;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .vault-item-url {
                font-size: 0.75rem;
                color: #9ca3af;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .vault-item-actions {
                display: flex;
                align-items: center;
                gap: 0.35rem;
                flex-shrink: 0;
            }

            .vault-action-btn {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.08);
                color: #9ca3af;
                width: 28px;
                height: 28px;
                border-radius: 7px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.15s ease;
                font-size: 0.8rem;
            }

            .vault-action-btn:hover {
                background: rgba(255, 255, 255, 0.15);
                color: #f3f4f6;
            }

            .vault-action-btn.btn-open {
                background: rgba(168, 85, 247, 0.15);
                border-color: rgba(168, 85, 247, 0.3);
                color: #c084fc;
            }
            .vault-action-btn.btn-open:hover {
                background: #a855f7;
                color: #fff;
            }

            .vault-action-btn.btn-delete:hover {
                background: rgba(239, 68, 68, 0.2);
                border-color: rgba(239, 68, 68, 0.4);
                color: #f87171;
            }

            .vault-empty-state {
                text-align: center;
                padding: 2rem 1rem;
                color: #6b7280;
                font-size: 0.875rem;
            }

            .vault-footer {
                padding: 0.85rem 1.5rem;
                background: rgba(0, 0, 0, 0.25);
                border-top: 1px solid rgba(255, 255, 255, 0.06);
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 0.75rem;
                color: #6b7280;
            }
        `;
        document.head.appendChild(style);

        // Modal Markup
        const modal = document.createElement('div');
        modal.id = 'private-vault-modal';
        modal.innerHTML = `
            <div class="vault-card" role="dialog" aria-modal="true" aria-labelledby="vault-title">
                <div class="vault-header">
                    <div class="vault-header-title" id="vault-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        <span>Private Bookmarks</span>
                        <span class="vault-badge">Vault</span>
                    </div>
                    <button class="vault-close-btn" id="vault-close-btn" aria-label="Close modal">✕</button>
                </div>

                <div class="vault-body">
                    <!-- Add form -->
                    <div class="vault-add-section">
                        <form id="vault-add-form" class="vault-form">
                            <div class="vault-input-group">
                                <input type="text" id="vault-title-input" class="vault-input" placeholder="Title (e.g. My Workspace)" required autocomplete="off">
                                <input type="url" id="vault-url-input" class="vault-input" placeholder="URL (https://...)" required autocomplete="off">
                            </div>
                            <button type="submit" class="vault-add-btn">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                                <span>Add Link</span>
                            </button>
                        </form>
                    </div>

                    <!-- Bookmarks List -->
                    <div class="vault-list-container">
                        <div class="vault-list-header">
                            <span>Saved Bookmarks</span>
                            <span id="vault-count-badge">0 links</span>
                        </div>
                        <div class="vault-list" id="vault-bookmarks-list">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                </div>

                <div class="vault-footer">
                    <span>🔒 Saved privately in your browser storage</span>
                    <span>Shortcut: <strong>Alt + B</strong></span>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Bind events
        const closeBtn = document.getElementById('vault-close-btn');
        closeBtn.addEventListener('click', closeVault);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeVault();
        });

        const addForm = document.getElementById('vault-add-form');
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const titleInput = document.getElementById('vault-title-input');
            const urlInput = document.getElementById('vault-url-input');

            let url = urlInput.value.trim();
            if (!/^https?:\/\//i.test(url)) {
                url = 'https://' + url;
            }

            const newBookmark = {
                id: 'bm_' + Date.now(),
                title: titleInput.value.trim(),
                url: url,
                createdAt: Date.now()
            };

            const list = getBookmarks();
            list.unshift(newBookmark);
            saveBookmarks(list);

            titleInput.value = '';
            urlInput.value = '';
            renderBookmarksList();
        });
    }

    function renderBookmarksList() {
        const container = document.getElementById('vault-bookmarks-list');
        const countBadge = document.getElementById('vault-count-badge');
        if (!container) return;

        const bookmarks = getBookmarks();
        if (countBadge) {
            countBadge.textContent = `${bookmarks.length} link${bookmarks.length === 1 ? '' : 's'}`;
        }

        if (bookmarks.length === 0) {
            container.innerHTML = `
                <div class="vault-empty-state">
                    No bookmarks yet. Add your private links above!
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        bookmarks.forEach(bm => {
            let domain = '';
            try {
                domain = new URL(bm.url).hostname;
            } catch(e) {
                domain = bm.url;
            }

            const item = document.createElement('div');
            item.className = 'vault-item';
            item.innerHTML = `
                <div class="vault-item-left" title="Click to open link">
                    <div class="vault-item-icon">
                        <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt="" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23a855f7\\' stroke-width=\\'2\\'><path d=\\'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\\'/><path d=\\'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\\'/></svg>'">
                    </div>
                    <div class="vault-item-details">
                        <span class="vault-item-name">${escapeHtml(bm.title)}</span>
                        <span class="vault-item-url">${escapeHtml(domain)}</span>
                    </div>
                </div>
                <div class="vault-item-actions">
                    <button class="vault-action-btn btn-open" title="Open Link">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    </button>
                    <button class="vault-action-btn btn-copy" title="Copy URL">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="vault-action-btn btn-delete" title="Delete Bookmark">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;

            // Open Link on left side or open button
            const openLink = () => {
                window.open(bm.url, '_blank', 'noopener,noreferrer');
            };
            item.querySelector('.vault-item-left').addEventListener('click', openLink);
            item.querySelector('.btn-open').addEventListener('click', openLink);

            // Copy button
            const copyBtn = item.querySelector('.btn-copy');
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(bm.url).then(() => {
                    copyBtn.innerHTML = `✓`;
                    setTimeout(() => {
                        copyBtn.innerHTML = `
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        `;
                    }, 1200);
                });
            });

            // Delete button
            item.querySelector('.btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Remove bookmark "${bm.title}"?`)) {
                    const list = getBookmarks().filter(x => x.id !== bm.id);
                    saveBookmarks(list);
                    renderBookmarksList();
                }
            });

            container.appendChild(item);
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function openVault() {
        createVaultModal();
        renderBookmarksList();
        const modal = document.getElementById('private-vault-modal');
        if (modal) {
            modal.classList.add('vault-open');
            setTimeout(() => {
                const titleInput = document.getElementById('vault-title-input');
                if (titleInput) titleInput.focus();
            }, 100);
        }
    }

    function closeVault() {
        const modal = document.getElementById('private-vault-modal');
        if (modal) {
            modal.classList.remove('vault-open');
        }
    }

    // Attach listeners to trigger elements
    function attachTriggerListeners() {
        // Intercept triggers
        const triggers = document.querySelectorAll(
            '.secret-trigger, .version, .footer p a, .footer a, [data-secret-vault]'
        );

        triggers.forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openVault();
            });
        });

        // Global shortcut: Alt + B
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeVault();
            } else if (e.altKey && (e.key === 'b' || e.key === 'B')) {
                e.preventDefault();
                const modal = document.getElementById('private-vault-modal');
                if (modal && modal.classList.contains('vault-open')) {
                    closeVault();
                } else {
                    openVault();
                }
            }
        });
    }

    // Expose API on window for manual access if needed
    window.SongFetchVault = {
        open: openVault,
        close: closeVault,
        getBookmarks: getBookmarks,
        addBookmark: function(title, url) {
            const list = getBookmarks();
            list.unshift({ id: 'bm_' + Date.now(), title, url, createdAt: Date.now() });
            saveBookmarks(list);
            renderBookmarksList();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            createVaultModal();
            attachTriggerListeners();
        });
    } else {
        createVaultModal();
        attachTriggerListeners();
    }
})();
