const API_BASE = window.API_BASE_URL || (window.location.hostname.includes('ct.ws') || window.location.hostname.includes('infinityfree') ? 'https://song-fetch.vercel.app' : '');

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

    
    // Download elements
    const downloadBtn = document.getElementById('download-btn');
    const downloadProgress = document.getElementById('download-progress');
    const progressStatus = document.getElementById('progress-status');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');
    const songFilesize = document.getElementById('song-filesize');

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

    // Search options elements
    const searchOptionsResult = document.getElementById('search-options-result');
    const searchOptionsList = document.getElementById('search-options-list');

    let currentSongData = null;

    // Quick Search Pills
    document.querySelectorAll('.quick-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const query = pill.getAttribute('data-query');
            if (query) {
                searchInput.value = query;
                clearBtn.classList.remove('hidden');
                searchForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        });
    });

    // Audio preview state
    let currentAudio = null;
    let audioState = { track: null, isPlaying: false, isLoading: false };
    const playerBar = document.getElementById('audio-player-bar');
    const playerPlayBtn = document.getElementById('player-play-btn');
    const playerProgress = document.getElementById('player-progress');
    const playerTimeCurrent = document.getElementById('player-time-current');
    const playerTimeTotal = document.getElementById('player-time-total');

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



    // Reset UI states before a new search
    function resetUI() {
        loader.classList.add('hidden');
        resultSection.classList.add('hidden');
        playlistResult.classList.add('hidden');
        searchOptionsResult.classList.add('hidden');
        errorCard.classList.add('hidden');
        downloadProgress.classList.add('hidden');
        downloadBtn.disabled = false;
        

        
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';

        // Reset playlist and options UI
        playlistProgress.classList.add('hidden');
        playlistProgressFill.style.width = '0%';
        playlistProgressPercent.textContent = '0/0';
        playlistTracksList.innerHTML = '';
        searchOptionsList.innerHTML = '';
        downloadAllBtn.disabled = false;
        if (songFilesize) {
            songFilesize.textContent = '';
        }

        // Stop any playing audio
        stopAudioPreview();
        resetPlayerBar();
    }

    // Update progress bar UI
    function updateProgressUI(percent, status) {
        progressFill.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressStatus.textContent = status;
    }

    // Fetch and display estimated song file size
    async function fetchAndDisplaySongSize(songData) {
        if (!songFilesize || !songData) return;
        songFilesize.textContent = 'Estimating file size...';
        try {
            const response = await fetch(`${API_BASE}/api/songfetch/size`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: songData.title,
                    artist: songData.artist,
                    youtubeUrl: songData.youtubeUrl
                })
            });
            if (response.ok) {
                const data = await response.json();
                songFilesize.textContent = `Estimated size: ${data.size}`;
            } else {
                songFilesize.textContent = 'Estimated size: Unknown';
            }
        } catch (error) {
            console.error('Failed to fetch song size:', error);
            songFilesize.textContent = 'Estimated size: Unknown';
        }
    }

    // Handle Form Submit (Search/Parse)
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;

        resetUI();
        
        const quickSearchContainer = document.getElementById('quick-search-container');
        if (quickSearchContainer) {
            quickSearchContainer.classList.add('hidden');
        }
        
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
            const response = await fetch(`${API_BASE}/api/search`, {
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
                            <button class="playlist-track-play-btn" title="Play preview" id="play-btn-${index}">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                            </button>
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

                    // Play button — stream audio preview
                    const playBtn = row.querySelector('.playlist-track-play-btn');
                    playBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await playAudioPreview(track, playBtn);
                    });

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
            } else if (data.isOptionsList) {
                // Update results count badge
                const count = data.options ? data.options.length : 0;
                const resultsBadge = document.getElementById('search-results-badge');
                if (resultsBadge) {
                    resultsBadge.textContent = `${count} result${count === 1 ? '' : 's'} available`;
                }

                // Populate Search Options list for verification
                searchOptionsList.innerHTML = '';
                data.options.forEach((track, index) => {
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
                            <button class="playlist-track-preview-btn" title="Select song" id="select-btn-${index}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </button>
                        </div>
                    `;
                    
                    searchOptionsList.appendChild(row);

                    // Row click triggers preview/select
                    row.addEventListener('click', async () => {
                        await previewPlaylistTrack(track, row);
                    });
                });
                
                searchOptionsResult.classList.remove('hidden');
                searchOptionsResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
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


                // Show result section and player bar
                resultSection.classList.remove('hidden');
                fetchAndDisplaySongSize(currentSongData);
                initPlayerBar(currentSongData);
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
                    status = 'Embedding ID3 metadata & cover art...';
                }

                updateProgressUI(simulatedProgress, status);
            }
        }, 600);

        try {
            // Initiate backend download and streaming
            const response = await fetch(`${API_BASE}/api/download`, {
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
        }
    });

    // Preview an individual track from the playlist — look it up and show the single result card
    async function previewPlaylistTrack(track, rowEl) {
        // Highlight selected row
        document.querySelectorAll('.playlist-track-row').forEach(r => r.classList.remove('selected'));
        if (rowEl) rowEl.classList.add('selected');

        // If track already has full details, display instantly
        if (track && track.title && track.artist && (track.artwork || track.youtubeUrl)) {
            currentSongData = track;
            coverArt.src = track.artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
            coverArt.onerror = () => { coverArt.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80'; };
            songTitle.textContent = track.title;
            songArtist.textContent = track.artist;
            songAlbum.textContent = track.album || 'Single';

            downloadBtn.disabled = false;
            downloadProgress.classList.add('hidden');
            resultSection.classList.remove('hidden');
            loader.classList.add('hidden');

            fetchAndDisplaySongSize(currentSongData);
            initPlayerBar(currentSongData);
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

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

            const response = await fetch(`${API_BASE}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queryOrUrl: query, resolveDirect: true })
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
            fetchAndDisplaySongSize(currentSongData);
            initPlayerBar(currentSongData);

            // Smoothly scroll to the result card
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (error) {
            loader.classList.add('hidden');
            errorCard.classList.remove('hidden');
            errorMessage.textContent = error.message;
            if (rowEl) rowEl.classList.remove('selected');
        }
    }

    // Download a single track from playlist list
    async function downloadPlaylistTrack(track, btnElement) {
        if (btnElement.classList.contains('downloading') || btnElement.classList.contains('success')) return;

        btnElement.classList.add('downloading');
        btnElement.disabled = true;
        btnElement.innerHTML = `<span class="spinner-mini"></span>`;

        try {
            const response = await fetch(`${API_BASE}/api/download`, {
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

            // Gentle delay between tracks to ensure stability
            if (i < total - 1) {
                await new Promise(r => setTimeout(r, 600));
            }
        }

        playlistProgressStatus.textContent = `Finished! Successfully downloaded ${successCount} out of ${total} tracks.`;
        downloadAllBtn.disabled = false;
    }
    // ─── Audio Preview System ────────────────────────────────────────

    function formatAudioTime(secs) {
        if (isNaN(secs) || !isFinite(secs)) return '0:00';
        const mins = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${mins}:${s.toString().padStart(2, '0')}`;
    }

    function buildStreamUrl(track) {
        if (track.title && track.artist) {
            return `/api/songfetch/stream?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&url=${encodeURIComponent(track.youtubeUrl || '')}`;
        }
        if (track.youtubeUrl && track.youtubeUrl.startsWith('http')) {
            return `/api/songfetch/stream?url=${encodeURIComponent(track.youtubeUrl)}`;
        }
        return `/api/songfetch/stream?title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}`;
    }

    function stopAudioPreview() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.src = '';
            currentAudio = null;
        }
        audioState.isPlaying = false;
        audioState.isLoading = false;
        // Reset all playlist play buttons
        document.querySelectorAll('.playlist-track-play-btn').forEach(btn => {
            btn.classList.remove('playing');
            btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
        });
    }

    function resetPlayerBar() {
        playerProgress.value = 0;
        playerTimeCurrent.textContent = '0:00';
        playerTimeTotal.textContent = '0:00';
        const playIcon = playerPlayBtn.querySelector('.play-icon');
        const pauseIcon = playerPlayBtn.querySelector('.pause-icon');
        const spinner = playerPlayBtn.querySelector('.player-loading-spinner');
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        spinner.classList.add('hidden');
    }

    function initPlayerBar(track) {
        // Stop current audio if different track
        if (audioState.track && (audioState.track.title !== track.title || audioState.track.artist !== track.artist)) {
            stopAudioPreview();
            resetPlayerBar();
        }
        audioState.track = track;
        // If nothing is playing, show the bar in paused state
        if (!audioState.isPlaying) {
            resetPlayerBar();
        }
    }

    function updatePlayerBarIcons() {
        const playIcon = playerPlayBtn.querySelector('.play-icon');
        const pauseIcon = playerPlayBtn.querySelector('.pause-icon');
        const spinner = playerPlayBtn.querySelector('.player-loading-spinner');

        if (audioState.isLoading) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.add('hidden');
            spinner.classList.remove('hidden');
        } else if (audioState.isPlaying && currentAudio && !currentAudio.paused) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            spinner.classList.add('hidden');
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            spinner.classList.add('hidden');
        }
    }

    async function playAudioPreview(track, triggerBtn) {
        const isSameTrack = audioState.track && 
            audioState.track.title === track.title && 
            audioState.track.artist === track.artist;

        // If clicking the same track that is playing, toggle pause/play
        if (isSameTrack && currentAudio) {
            if (audioState.isPlaying) {
                currentAudio.pause();
                audioState.isPlaying = false;
                if (triggerBtn) {
                    triggerBtn.classList.remove('playing');
                    triggerBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                }
                updatePlayerBarIcons();
                return;
            } else {
                currentAudio.play();
                audioState.isPlaying = true;
                if (triggerBtn) {
                    triggerBtn.classList.add('playing');
                    triggerBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
                }
                updatePlayerBarIcons();
                return;
            }
        }

        // Different track or no audio — stop current and start new
        stopAudioPreview();
        resetPlayerBar();

        audioState.track = track;
        audioState.isLoading = true;
        audioState.isPlaying = false;

        if (triggerBtn) {
            triggerBtn.classList.add('playing');
            triggerBtn.innerHTML = `<span class="spinner-mini"></span>`;
        }
        updatePlayerBarIcons();

        try {
            const streamUrl = buildStreamUrl(track);
            currentAudio = new Audio(streamUrl);
            currentAudio.preload = 'auto';

            currentAudio.addEventListener('playing', () => {
                audioState.isLoading = false;
                audioState.isPlaying = true;
                if (triggerBtn) {
                    triggerBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
                }
                updatePlayerBarIcons();
            });

            currentAudio.addEventListener('timeupdate', () => {
                if (!currentAudio) return;
                const cur = currentAudio.currentTime;
                const dur = currentAudio.duration || 0;
                if (dur > 0) {
                    playerProgress.value = (cur / dur) * 100;
                }
                playerTimeCurrent.textContent = formatAudioTime(cur);
                playerTimeTotal.textContent = formatAudioTime(dur);
            });

            currentAudio.addEventListener('ended', () => {
                audioState.isPlaying = false;
                if (triggerBtn) {
                    triggerBtn.classList.remove('playing');
                    triggerBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                }
                updatePlayerBarIcons();
            });

            currentAudio.addEventListener('error', () => {
                console.error('Audio playback error');
                audioState.isPlaying = false;
                audioState.isLoading = false;
                if (triggerBtn) {
                    triggerBtn.classList.remove('playing');
                    triggerBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                }
                resetPlayerBar();
                updatePlayerBarIcons();
            });

            await currentAudio.play();
        } catch (err) {
            console.error('Failed to play audio:', err);
            audioState.isPlaying = false;
            audioState.isLoading = false;
            if (triggerBtn) {
                triggerBtn.classList.remove('playing');
                triggerBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
            }
            resetPlayerBar();
            updatePlayerBarIcons();
        }
    }

    // Player bar play/pause button
    playerPlayBtn.addEventListener('click', async () => {
        if (!audioState.track) return;
        await playAudioPreview(audioState.track, null);
    });

    // Player bar seek slider
    playerProgress.addEventListener('input', () => {
        if (currentAudio && currentAudio.duration) {
            currentAudio.currentTime = (playerProgress.value / 100) * currentAudio.duration;
        }
    });
});

/* ─── PWA Install Logic ───────────────────────────────────────────── */



