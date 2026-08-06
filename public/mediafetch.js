document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-btn');
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    const resultSection = document.getElementById('result');
    const errorCard = document.getElementById('error-card');
    const errorMessage = document.getElementById('error-message');

    // Media details card elements
    const videoThumbnail = document.getElementById('video-thumbnail');
    const videoTitle = document.getElementById('video-title');
    const videoUploader = document.getElementById('video-uploader');
    const videoDuration = document.getElementById('video-duration');
    const videoPlatformLabel = document.getElementById('video-platform-label');
    
    // Selectors
    const qualitySelectorBlock = document.getElementById('quality-selector-block');
    const qualitySelect = document.getElementById('quality-select');
    const photoSelectionContainer = document.getElementById('photo-selection-container');
    const photoGrid = document.getElementById('photo-grid');
    const selectAllPhotos = document.getElementById('select-all-photos');

    // Download elements
    const downloadBtn = document.getElementById('download-btn');
    const downloadBtnText = document.getElementById('download-btn-text');
    const downloadProgress = document.getElementById('download-progress');
    const progressStatus = document.getElementById('progress-status');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');

    let currentMediaData = null;

    // Show/hide clear button on input
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
        errorCard.classList.add('hidden');
        downloadProgress.classList.add('hidden');
        downloadBtn.disabled = false;
        
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';
    }

    // Helper: Display custom error message
    function showError(message) {
        resetUI();
        errorMessage.textContent = message;
        errorCard.classList.remove('hidden');
        errorCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Helper: Update download progress bar UI
    function updateProgressUI(percent, status) {
        progressFill.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressStatus.textContent = status;
    }

    // Toggle select all photos
    selectAllPhotos.addEventListener('change', () => {
        const checkboxes = photoGrid.querySelectorAll('.photo-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = selectAllPhotos.checked;
        });
        updateDownloadButtonText();
    });

    function updateDownloadButtonText() {
        if (currentMediaData && currentMediaData.images) {
            const checkedCount = photoGrid.querySelectorAll('.photo-checkbox:checked').length;
            if (checkedCount === 1) {
                downloadBtnText.textContent = 'Download Single Photo';
            } else {
                downloadBtnText.textContent = `Download ${checkedCount} Selected Photos (ZIP)`;
            }
        } else {
            downloadBtnText.textContent = 'Download Video';
        }
    }

    // Form Submission: Fetch metadata
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = searchInput.value.trim();
        if (!url) return;

        resetUI();
        loaderText.textContent = 'Analyzing link...';
        loader.classList.remove('hidden');

        // Basic frontend URL parsing to guide user support
        const urlLower = url.toLowerCase();
        const isValidPlatform = urlLower.includes('youtube.com') || 
                                urlLower.includes('youtu.be') || 
                                urlLower.includes('instagram.com') || 
                                urlLower.includes('tiktok.com') ||
                                urlLower.includes('facebook.com') ||
                                urlLower.includes('fb.watch');

        if (!isValidPlatform) {
            showError('Please paste a valid video or photo URL from YouTube, Instagram, TikTok, or Facebook.');
            return;
        }

        try {
            const response = await fetch('/api/mediafetch/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to extract media details.');
            }

            const data = await response.json();
            currentMediaData = {
                url: url,
                title: data.title,
                thumbnail: data.thumbnail,
                duration: data.duration,
                uploader: data.uploader,
                platform: data.platform,
                formats: data.formats,
                images: data.images
            };

            // Populate Video Info details
            videoThumbnail.src = data.thumbnail;
            videoThumbnail.referrerPolicy = 'no-referrer';
            videoTitle.textContent = data.title;
            videoUploader.textContent = data.uploader;
            videoDuration.textContent = data.duration;
            videoPlatformLabel.textContent = data.platform.toUpperCase();

            // Populate selectors depending on if we have images or formats
            if (data.images && data.images.length > 0) {
                // Populate Photo Selection Grid
                qualitySelectorBlock.classList.add('hidden');
                photoSelectionContainer.classList.remove('hidden');
                photoGrid.innerHTML = '';
                
                selectAllPhotos.checked = true;

                data.images.forEach(img => {
                    const card = document.createElement('div');
                    card.className = 'photo-grid-card';
                    card.innerHTML = `
                        <label class="photo-grid-label">
                            <input type="checkbox" class="photo-checkbox" data-url="${img.url}" checked>
                            <span class="custom-checkbox-ui"></span>
                            <img src="${img.url}" referrerpolicy="no-referrer" alt="Slide ${img.index + 1}">
                            <div class="photo-index-badge">${img.index + 1}</div>
                        </label>
                    `;
                    
                    // Bind change listener to update download count
                    card.querySelector('.photo-checkbox').addEventListener('change', () => {
                        const total = photoGrid.querySelectorAll('.photo-checkbox').length;
                        const checked = photoGrid.querySelectorAll('.photo-checkbox:checked').length;
                        selectAllPhotos.checked = (total === checked);
                        updateDownloadButtonText();
                    });
                    
                    photoGrid.appendChild(card);
                });
            } else {
                // Populate Quality Options for video
                photoSelectionContainer.classList.add('hidden');
                qualitySelectorBlock.classList.remove('hidden');
                
                qualitySelect.innerHTML = '';
                
                if (data.platform === 'youtube') {
                    // Add formats returned from server
                    data.formats.forEach(f => {
                        const h = (f && typeof f === 'object') ? f.height : f;
                        const sizeStr = (f && typeof f === 'object') ? f.size : null;
                        
                        let label = `${h}p (SD)`;
                        if (h >= 2160) label = `${h}p (4K UHD)`;
                        else if (h >= 1440) label = `${h}p (2K QHD)`;
                        else if (h >= 1080) label = `${h}p (Full HD)`;
                        else if (h >= 720) label = `${h}p (HD)`;
                        
                        if (sizeStr) {
                            label += ` - ${sizeStr}`;
                        }
                        
                        const option = document.createElement('option');
                        option.value = h;
                        option.textContent = label;
                        qualitySelect.appendChild(option);
                    });

                    // Always add best option and audio options
                    const bestOption = document.createElement('option');
                    bestOption.value = 'best';
                    bestOption.textContent = `Best Available Quality${data.bestSize ? ` - ${data.bestSize}` : ''}`;
                    qualitySelect.insertBefore(bestOption, qualitySelect.firstChild);

                    const audioOption = document.createElement('option');
                    audioOption.value = 'audio';
                    audioOption.textContent = `Audio Only (MP3)${data.audioSize ? ` - ${data.audioSize}` : ''}`;
                    qualitySelect.appendChild(audioOption);
                } else {
                    // TikTok, Instagram, and Facebook only download in Best Quality
                    const bestOption = document.createElement('option');
                    bestOption.value = 'best';
                    const sizeStr = (data.formats && data.formats[0]) ? data.formats[0].size : data.bestSize;
                    bestOption.textContent = `Best Quality (Watermark-Free)${sizeStr ? ` - ${sizeStr}` : ''}`;
                    qualitySelect.appendChild(bestOption);
                }
            }

            updateDownloadButtonText();

            // Reveal results
            loader.classList.add('hidden');
            resultSection.classList.remove('hidden');
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } catch (error) {
            console.error('Info fetching error:', error);
            showError(error.message || 'An error occurred while fetching media info.');
        }
    });

    // Download Button Action
    downloadBtn.addEventListener('click', async () => {
        if (!currentMediaData) return;

        if (currentMediaData.images && currentMediaData.images.length > 0) {
            // Photo download branch
            const checkedBoxes = photoGrid.querySelectorAll('.photo-checkbox:checked');
            if (checkedBoxes.length === 0) {
                alert('Please select at least one photo to download.');
                return;
            }

            const urls = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-url'));

            downloadBtn.disabled = true;
            downloadProgress.classList.remove('hidden');
            updateProgressUI(0, 'Packaging photos...');

            // Simulated packaging progress
            let simulatedProgress = 0;
            const simulatedInterval = setInterval(() => {
                if (simulatedProgress < 90) {
                    simulatedProgress += 15;
                    if (simulatedProgress > 90) simulatedProgress = 90;
                    updateProgressUI(simulatedProgress, 'Downloading photos and creating ZIP archive...');
                }
            }, 300);

            try {
                const response = await fetch('/api/mediafetch/download-photos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        urls: urls,
                        title: currentMediaData.title
                    })
                });

                clearInterval(simulatedInterval);

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'Server-side photo processing failed.');
                }

                updateProgressUI(95, 'Transferring ZIP archive to browser...');

                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = blobUrl;

                const disposition = response.headers.get('content-disposition');
                let filename = `${currentMediaData.title}_photos.zip`;
                if (disposition && disposition.includes('filename=')) {
                    filename = decodeURIComponent(disposition.split('filename=')[1].replace(/['"]/g, ''));
                }
                
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);

                updateProgressUI(100, 'Photos downloaded successfully!');

                setTimeout(() => {
                    downloadBtn.disabled = false;
                    downloadProgress.classList.add('hidden');
                }, 3000);

            } catch (err) {
                clearInterval(simulatedInterval);
                console.error('Photo download failed:', err);
                showError(`Photo download failed: ${err.message}`);
            }

        } else {
            // Video download branch
            const quality = qualitySelect.value;
            const isAudio = quality === 'audio';

            downloadBtn.disabled = true;
            downloadProgress.classList.remove('hidden');
            updateProgressUI(0, 'Initializing downloader...');

            // Smooth simulated progress bar stages (0% - 90%)
            let simulatedProgress = 0;
            const simulatedInterval = setInterval(() => {
                if (simulatedProgress < 90) {
                    let step = 1;
                    if (simulatedProgress < 30) step = 3;
                    else if (simulatedProgress < 60) step = 2;
                    
                    simulatedProgress += step;
                    if (simulatedProgress > 90) simulatedProgress = 90;

                    let status = 'Downloading video streams...';
                    if (isAudio) {
                        if (simulatedProgress > 50) status = 'Converting audio stream to MP3...';
                        else status = 'Downloading audio stream...';
                    } else {
                        if (simulatedProgress > 45) status = 'Merging audio & video streams with FFmpeg...';
                        else status = 'Downloading video stream...';
                    }

                    updateProgressUI(simulatedProgress, status);
                }
            }, 800);

            try {
                const response = await fetch('/api/mediafetch/download', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: currentMediaData.url,
                        quality: quality,
                        title: currentMediaData.title
                    })
                });

                clearInterval(simulatedInterval);

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'Server-side download or processing failed.');
                }

                // Stream progress from response content-length
                const contentLength = response.headers.get('content-length');
                const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

                const reader = response.body.getReader();
                let loadedBytes = 0;
                const chunks = [];

                updateProgressUI(90, 'Transferring media file to browser...');

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    chunks.push(value);
                    loadedBytes += value.length;

                    if (totalBytes > 0) {
                        const downloadPercent = Math.round((loadedBytes / totalBytes) * 10);
                        const totalPercent = 90 + downloadPercent;
                        const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1);
                        const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                        updateProgressUI(totalPercent, `Downloading: ${loadedMB}MB of ${totalMB}MB...`);
                    }
                }

                updateProgressUI(100, 'Download complete!');

                const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';
                const blob = new Blob(chunks, { type: mimeType });
                const blobUrl = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = blobUrl;
                
                const ext = isAudio ? 'mp3' : 'mp4';
                const safeFilename = `${currentMediaData.title}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
                
                a.download = safeFilename;
                document.body.appendChild(a);
                a.click();
                
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);

                setTimeout(() => {
                    downloadBtn.disabled = false;
                    downloadProgress.classList.add('hidden');
                }, 3000);

            } catch (error) {
                clearInterval(simulatedInterval);
                console.error('Video download failed:', error);
                showError(`Download failed: ${error.message}`);
            }
        }
    });
});
