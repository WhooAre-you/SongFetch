document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-btn');
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    const resultSection = document.getElementById('result');
    const errorCard = document.getElementById('error-card');
    const errorMessage = document.getElementById('error-message');
    
    // Song details elements
    const coverArt = document.getElementById('cover-art');
    const songTitle = document.getElementById('song-title');
    const songArtist = document.getElementById('song-artist');
    const songAlbum = document.getElementById('song-album');
    const lyricsText = document.getElementById('lyrics-text');
    const lyricsAccordion = document.querySelector('.lyrics-accordion');
    const lyricsToggleBtn = document.getElementById('lyrics-toggle-btn');
    const lyricsViewport = document.getElementById('lyrics-viewport');
    
    // Download elements
    const downloadBtn = document.getElementById('download-btn');
    const downloadProgress = document.getElementById('download-progress');
    const progressStatus = document.getElementById('progress-status');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');

    // Playlist elements
    const playlistResult = document.getElementById('playlist-result');
    const playlistCover = document.getElementById('playlist-cover');
    const playlistTitle = document.getElementById('playlist-title');
    const playlistCurator = document.getElementById('playlist-curator');
    const playlistTrackCount = document.getElementById('playlist-track-count');
    const playlistTracksList = document.getElementById('playlist-tracks-list');
    const downloadAllBtn = document.getElementById('download-all-btn');
    const playlistProgress = document.getElementById('playlist-progress-bar-container');
    const playlistProgressPercent = document.getElementById('playlist-progress-percent');
    const playlistProgressFill = document.getElementById('playlist-progress-fill');
    const playlistProgressStatus = document.getElementById('playlist-progress-status');

    let currentSongData = null;

    // Show/hide clear button on input change
    searchInput.addEventListener('input', () => {
        if (searchInput.value.trim().length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    });

    // Clear input handler
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.classList.add('hidden');
        searchInput.focus();
    });

    // Toggle Lyrics Accordion
    lyricsToggleBtn.addEventListener('click', () => {
        const isOpen = lyricsAccordion.classList.contains('open');
        if (isOpen) {
            lyricsAccordion.classList.remove('open');
            lyricsViewport.style.maxHeight = '0px';
        } else {
            lyricsAccordion.classList.add('open');
            // Give it dynamic max-height for transition
            lyricsViewport.style.maxHeight = '400px';
            // Scroll to lyrics smoothly
            setTimeout(() => {
                lyricsAccordion.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
    });

    // Reset UI states before a new search
    function resetUI() {
        loader.classList.add('hidden');
        resultSection.classList.add('hidden');
        playlistResult.classList.add('hidden');
        errorCard.classList.add('hidden');
        downloadProgress.classList.add('hidden');
        downloadBtn.disabled = false;
        
        lyricsAccordion.classList.remove('open');
        lyricsViewport.style.maxHeight = '0px';
        
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';

        // Reset playlist UI
        playlistProgress.classList.add('hidden');
        playlistProgressFill.style.width = '0%';
        playlistProgressPercent.textContent = '0/0';
        playlistTracksList.innerHTML = '';
        downloadAllBtn.disabled = false;
    }

    // Update progress bar UI
    function updateProgressUI(percent, status) {
        progressFill.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressStatus.textContent = status;
    }

    // Handle Form Submit (Search/Parse)
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;

        resetUI();
        
        // Show loading state
        loader.classList.remove('hidden');
        loaderText.textContent = "Connecting to server...";
        
        // Determine search type for loading text
        if (query.startsWith('http://') || query.startsWith('https://')) {
            loaderText.textContent = "Fetching metadata from link...";
        } else {
            loaderText.textContent = `Searching for "${query}"...`;
        }

        try {
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ queryOrUrl: query })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to retrieve song details.');
            }

            loader.classList.add('hidden');

            if (data.isPlaylist) {
                // Populate Playlist details
                playlistCover.src = data.artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
                playlistCover.onerror = () => {
                    playlistCover.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
                };
                playlistTitle.textContent = data.title;
                playlistCurator.textContent = `Curator: ${data.artist}`;
                playlistTrackCount.textContent = `${data.tracks.length} track${data.tracks.length === 1 ? '' : 's'}`;

                // Build playlist track rows
                data.tracks.forEach((track, index) => {
                    const row = document.createElement('div');
                    row.className = 'playlist-track-row';
                    row.setAttribute('data-index', index);
                    
                    const safeMiniArtwork = track.artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=80&q=80';
                    row.innerHTML = `
                        <div class="playlist-track-details">
                            <div class="playlist-track-thumb-wrap">
                                <img class="playlist-track-mini-cover" src="${safeMiniArtwork}" alt="Track Cover"
                                    onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=80&q=80'">
                            </div>
                            <div class="playlist-track-text">
                                <span class="playlist-track-title">${track.title}</span>
                                <span class="playlist-track-artist">${track.artist}</span>
                            </div>
                        </div>
                        <div class="playlist-track-actions">
                            <button class="playlist-track-preview-btn" title="Preview song details" id="preview-btn-${index}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="11" cy="11" r="8"></circle>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                </svg>
                            </button>
                            <button class="playlist-track-download-btn" title="Download track" id="track-btn-${index}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                            </button>
                        </div>
                    `;
                    
                    playlistTracksList.appendChild(row);

                    // Download button
                    const btn = row.querySelector('.playlist-track-download-btn');
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await downloadPlaylistTrack(track, btn);
                    });

                    // Preview button — look up the individual song
                    const previewBtn = row.querySelector('.playlist-track-preview-btn');
                    previewBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await previewPlaylistTrack(track, row);
                    });

                    // Clicking the row itself also triggers preview
                    row.addEventListener('click', async () => {
                        await previewPlaylistTrack(track, row);
                    });
                });

                playlistResult.classList.remove('hidden');
                
                // Set click listener for Download All
                downloadAllBtn.onclick = async () => {
                    await downloadAllPlaylistTracks(data.tracks);
                };
            } else {
                // Store song data globally for single download
                currentSongData = data;

                // Populate UI with retrieved metadata
                coverArt.src = data.artwork || 'placeholder-cover.png'; // Fallback if no art
                coverArt.onerror = () => {
                    coverArt.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80'; // Stylized music fallback image
                };
                
                songTitle.textContent = data.title;
                songArtist.textContent = data.artist;
                songAlbum.textContent = data.album || 'Single';
                lyricsText.textContent = data.lyrics || 'Lyrics not found on Genius.';

                // Show result section
                resultSection.classList.remove('hidden');
            }

        } catch (error) {
            console.error('Search error:', error);
            loader.classList.add('hidden');
            errorCard.classList.remove('hidden');
            errorMessage.textContent = error.message;
        }
    });

    // Handle Download click
    downloadBtn.addEventListener('click', async () => {
        if (!currentSongData) return;

        downloadBtn.disabled = true;
        downloadProgress.classList.remove('hidden');
        
        let simulatedProgress = 0;
        updateProgressUI(0, 'Initializing download task...');

        // Start simulated progress during server-side download/convert/tag
        const simulatedInterval = setInterval(() => {
            if (simulatedProgress < 85) {
                // Slower increment as it approaches 85%
                const increment = simulatedProgress < 50 
                    ? Math.floor(Math.random() * 8) + 4 
                    : Math.floor(Math.random() * 3) + 1;
                
                simulatedProgress += increment;
                if (simulatedProgress > 85) simulatedProgress = 85;

                let status = 'Downloading audio from YouTube...';
                if (simulatedProgress > 45 && simulatedProgress <= 70) {
                    status = 'Converting audio to MP3 using FFmpeg...';
                } else if (simulatedProgress > 70) {
                    status = 'Embedding ID3 metadata & Genius lyrics...';
                }

                updateProgressUI(simulatedProgress, status);
            }
        }, 600);

        try {
            // Initiate backend download and streaming
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(currentSongData)
            });

            clearInterval(simulatedInterval);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Server processing failed.');
            }

            // Read the stream progress from client download
            const contentLength = response.headers.get('content-length');
            const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
            
            const reader = response.body.getReader();
            let loadedBytes = 0;
            const chunks = [];

            updateProgressUI(85, 'Transferring MP3 file...');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                loadedBytes += value.length;

                if (totalBytes > 0) {
                    // Map the remaining 15% (85% to 100%) during actual file delivery
                    const downloadPercent = Math.round((loadedBytes / totalBytes) * 15);
                    const totalPercent = 85 + downloadPercent;
                    updateProgressUI(totalPercent, 'Downloading MP3...');
                }
            }

            updateProgressUI(100, 'Download complete!');

            // Convert gathered chunks to blob and download in browser
            const blob = new Blob(chunks, { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = blobUrl;
            
            // Build safe local file name
            const safeFilename = `${currentSongData.artist} - ${currentSongData.title}.mp3`
                .replace(/[\\/:*?"<>|]/g, '_');
            
            a.download = safeFilename;
            document.body.appendChild(a);
            a.click();
            
            // Cleanup download elements
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);

            // Keep progress screen visible for 3 seconds, then restore download button
            setTimeout(() => {
                downloadProgress.classList.add('hidden');
                downloadBtn.disabled = false;
            }, 3000);

        } catch (error) {
            clearInterval(simulatedInterval);
            console.error('Download error:', error);
            updateProgressUI(0, `Error: ${error.message}`);
            downloadBtn.disabled = false;
        }\n    });

    // Preview an individual track from the playlist — look it up and show the single result card
    async function previewPlaylistTrack(track, rowEl) {
        // Highlight selected row
        document.querySelectorAll('.playlist-track-row').forEach(r => r.classList.remove('selected'));
        rowEl.classList.add('selected');

        // Show loader
        loader.classList.remove('hidden');
        resultSection.classList.add('hidden');
        errorCard.classList.add('hidden');
        loaderText.textContent = `Looking up "${track.title}"...`;

        try {
            // Use the track's direct URL if available, otherwise search by title + artist
            const query = track.youtubeUrl && track.youtubeUrl.startsWith('http')
                ? track.youtubeUrl
                : `${track.title} ${track.artist}`;

            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queryOrUrl: query })
            });

            const data = await response.json();
            loader.classList.add('hidden');

            if (!response.ok || data.isPlaylist) {
                throw new Error(data.error || 'Could not fetch individual track data.');
            }

            // Populate the single song card
            currentSongData = data;
            coverArt.src = data.artwork || track.artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
            coverArt.onerror = () => { coverArt.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80'; };
            songTitle.textContent = data.title;
            songArtist.textContent = data.artist;
            songAlbum.textContent = data.album || 'Single';
            lyricsText.textContent = data.lyrics || 'Lyrics not found.';

            // Reset download button
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Download MP3</span>
            `;
            downloadProgress.classList.add('hidden');

            resultSection.classList.remove('hidden');

            // Smoothly scroll to the result card
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (error) {
            loader.classList.add('hidden');
            errorCard.classList.remove('hidden');
            errorMessage.textContent = error.message;
            rowEl.classList.remove('selected');
        }
    }

    // Download a single track from playlist list
    async function downloadPlaylistTrack(track, btnElement) {
        if (btnElement.classList.contains('downloading') || btnElement.classList.contains('success')) return;

        btnElement.classList.add('downloading');
        btnElement.disabled = true;
        btnElement.innerHTML = `<span class="spinner-mini"></span>`;

        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(track)
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Server error');
            }

            const reader = response.body.getReader();
            const contentLength = response.headers.get('content-length');
            const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
            let loadedBytes = 0;
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loadedBytes += value.length;
            }

            const blob = new Blob(chunks, { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = blobUrl;
            
            const safeFilename = `${track.artist} - ${track.title}.mp3`
                .replace(/[\\/:*?"<>|]/g, '_');
            
            a.download = safeFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);

            btnElement.classList.remove('downloading');
            btnElement.classList.add('success');
            btnElement.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
            return true;
        } catch (error) {
            console.error('Track download error:', error);
            btnElement.classList.remove('downloading');
            btnElement.classList.add('error');
            btnElement.disabled = false;
            btnElement.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            `;
            return false;
        }
    }

    // Download all playlist tracks sequentially
    async function downloadAllPlaylistTracks(tracks) {
        downloadAllBtn.disabled = true;
        playlistProgress.classList.remove('hidden');
        
        const total = tracks.length;
        playlistProgressPercent.textContent = `0/${total}`;
        playlistProgressFill.style.width = '0%';
        playlistProgressStatus.textContent = `Starting download of ${total} tracks...`;

        let successCount = 0;

        for (let i = 0; i < total; i++) {
            const track = tracks[i];
            const btn = document.getElementById(`track-btn-${i}`);
            
            playlistProgressStatus.textContent = `Downloading track ${i + 1} of ${total}: "${track.title}"...`;
            
            // Trigger download and wait for it to complete before starting next track
            const success = await downloadPlaylistTrack(track, btn);
            if (success) successCount++;

            // Update progress bar
            const percent = Math.round(((i + 1) / total) * 100);
            playlistProgressFill.style.width = `${percent}%`;
            playlistProgressPercent.textContent = `${i + 1}/${total}`;
        }

        playlistProgressStatus.textContent = `Finished! Successfully downloaded ${successCount} out of ${total} tracks.`;
        downloadAllBtn.disabled = false;
    }
});

/* ─── PWA Install Logic ───────────────────────────────────────────── */

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[SW] Registered:', reg.scope))
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
    const isSafari = /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent);

    let steps = '';
    if (isIosBrowser) {
        steps = `
            <div class="guide-step"><span class="guide-num">1</span>Tap the <strong>Share</strong> button <span style="font-size:1.1em">⎋</span> at the bottom of Safari</div>
            <div class="guide-step"><span class="guide-num">2</span>Scroll down and tap <strong>"Add to Home Screen"</strong></div>
            <div class="guide-step"><span class="guide-num">3</span>Tap <strong>"Add"</strong> — SongFetch will appear on your home screen!</div>
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
                    <strong>Add SongFetch to Home Screen</strong>
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

