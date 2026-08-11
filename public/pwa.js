// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                reg.update();
                console.log('[SW] Registered & Updated:', reg.scope);
            })
            .catch(err => console.warn('[SW] Registration failed:', err));
    });
}

let deferredPrompt = null;
const installBtn = document.getElementById('pwa-install-btn');

// ── Detect platform ──
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInStandaloneMode = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

// Create a floating how-to popup for browsers that don't support native prompts
function showInstallGuidePopup() {
    // Remove any existing popup
    const existing = document.getElementById('install-guide-popup');
    if (existing) existing.remove();

    const isIosBrowser = /iphone|ipad|ipod/i.test(navigator.userAgent);

    let steps = '';
    if (isIosBrowser) {
        steps = `
            <div class="guide-step"><span class="guide-num">1</span>Tap the <strong>Share</strong> button <span style="font-size:1.1em">⎋</span> at the bottom of Safari</div>
            <div class="guide-step"><span class="guide-num">2</span>Scroll down and tap <strong>"Add to Home Screen"</strong></div>
            <div class="guide-step"><span class="guide-num">3</span>Tap <strong>"Add"</strong> — OmniFetch will appear on your home screen!</div>
        `;
    } else {
        steps = `
            <div class="guide-step"><span class="guide-num">1</span>Click the <strong>menu icon (⋮)</strong> in your browser's top-right corner</div>
            <div class="guide-step"><span class="guide-num">2</span>Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></div>
            <div class="guide-step"><span class="guide-num">3</span>Click <strong>Install</strong> — done!</div>
        `;
    }

    const popup = document.createElement('div');
    popup.id = 'install-guide-popup';
    popup.innerHTML = `
        <div class="guide-overlay" id="guide-overlay"></div>
        <div class="guide-modal">
            <div class="guide-header">
                <div class="guide-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18V5l12-2v13"></path>
                        <circle cx="6" cy="18" r="3"></circle>
                        <circle cx="18" cy="16" r="3"></circle>
                    </svg>
                </div>
                <div>
                    <strong>Add OmniFetch to Home Screen</strong>
                    <span>No download needed — it's instant!</span>
                </div>
                <button class="guide-close" id="guide-close">✕</button>
            </div>
            <div class="guide-steps">${steps}</div>
        </div>
    `;
    document.body.appendChild(popup);

    document.getElementById('guide-overlay').addEventListener('click', () => popup.remove());
    document.getElementById('guide-close').addEventListener('click', () => popup.remove());
}

// ── Android / Chrome: capture the native install prompt ──
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

// ── Button click handler ──
if (installBtn) {
    // Show/check initial state
    if (isInStandaloneMode) {
        installBtn.innerHTML = '✓ Installed';
        installBtn.disabled = true;
    }

    installBtn.addEventListener('click', async () => {
        // If already installed, do nothing
        if (isInStandaloneMode) {
            installBtn.textContent = '✓ Already Installed';
            return;
        }

        if (deferredPrompt) {
            // Chrome/Android: show native dialog
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.innerHTML = '✓ Installed!';
                installBtn.disabled = true;
            }
            deferredPrompt = null;
        } else {
            // iOS / Firefox / others: show step-by-step guide
            showInstallGuidePopup();
        }
    });
}

// Hide button once app is installed via native flow
window.addEventListener('appinstalled', () => {
    if (installBtn) {
        installBtn.innerHTML = '✓ Installed!';
        installBtn.disabled = true;
    }
    deferredPrompt = null;
});

// ── iOS bottom banner (auto-show on Safari) ──
const iosBannerDismissed = sessionStorage.getItem('iosBannerDismissed');
if (isIos && !isInStandaloneMode && !iosBannerDismissed) {
    const banner = document.getElementById('ios-install-banner');
    const closeBtn = document.getElementById('ios-banner-close');
    if (banner) {
        setTimeout(() => banner.classList.remove('hidden'), 1500);
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                banner.classList.add('hidden');
                sessionStorage.setItem('iosBannerDismissed', '1');
            });
        }
    }
}
