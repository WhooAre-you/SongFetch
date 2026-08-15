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
    const videoFilesizeContainer = document.getElementById('video-filesize-container');
    const videoFilesizeLabel = document.getElementById('video-filesize-label');
    
    // Selectors
    const qualitySelectorBlock = document.getElementById('quality-selector-block');
    const qualitySelect = document.getElementById('quality-select');
    const customQualityWrapper = document.getElementById('custom-quality-wrapper');
    const customQualityTrigger = document.getElementById('custom-quality-trigger');
    const selectedQualityBadge = document.getElementById('selected-quality-badge');
    const selectedQualityText = document.getElementById('selected-quality-text');
    const selectedQualitySize = document.getElementById('selected-quality-size');
    const customQualityOptions = document.getElementById('custom-quality-options');

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

    // Custom Dropdown Open/Close Handlers
    if (customQualityTrigger) {
        customQualityTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = customQualityWrapper && customQualityWrapper.classList.contains('open');
            if (isOpen) {
                closeCustomDropdown();
            } else {
                openCustomDropdown();
            }
        });
    }

    function openCustomDropdown() {
        if (!customQualityWrapper || !customQualityOptions) return;
        customQualityWrapper.classList.add('open');
        customQualityOptions.classList.remove('hidden');
        if (customQualityTrigger) customQualityTrigger.setAttribute('aria-expanded', 'true');
    }

    function closeCustomDropdown() {
        if (!customQualityWrapper || !customQualityOptions) return;
        customQualityWrapper.classList.remove('open');
        customQualityOptions.classList.add('hidden');
        if (customQualityTrigger) customQualityTrigger.setAttribute('aria-expanded', 'false');
    }

    document.addEventListener('click', (e) => {
        if (customQualityWrapper && !customQualityWrapper.contains(e.target)) {
            closeCustomDropdown();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCustomDropdown();
        }
    });

    function setupCustomQualityOptions(optionsList) {
        if (!customQualityOptions || !qualitySelect) return;
        customQualityOptions.innerHTML = '';
        qualitySelect.innerHTML = '';

        if (!optionsList || optionsList.length === 0) return;

        optionsList.forEach((opt, idx) => {
            // Native option element for backup/forms
            const nativeOpt = document.createElement('option');
            nativeOpt.value = opt.value;
            nativeOpt.textContent = `${opt.name}${opt.size ? ` - ${opt.size}` : ''}`;
            if (opt.url) nativeOpt.dataset.url = opt.url;
            qualitySelect.appendChild(nativeOpt);

            // Custom UI item
            const item = document.createElement('div');
            item.className = `custom-option-item${idx === 0 ? ' selected' : ''}`;
            item.setAttribute('role', 'option');
            item.setAttribute('data-value', opt.value);
            item.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');

            item.innerHTML = `
                <div class="option-left">
                    <span class="quality-badge ${opt.badgeClass || 'badge-sd'}">${opt.badge}</span>
                    <span class="option-name">${opt.name}</span>
                </div>
                <div class="option-right">
                    ${opt.size ? `<span class="option-size">${opt.size}</span>` : ''}
                    <svg class="option-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
            `;

            item.addEventListener('click', () => {
                selectQualityOption(opt, item);
                closeCustomDropdown();
            });

            customQualityOptions.appendChild(item);
        });

        // Set initial selected item
        selectQualityOption(optionsList[0], customQualityOptions.firstElementChild);
    }

    function selectQualityOption(opt, itemEl) {
        if (!opt) return;
        qualitySelect.value = opt.value;
        
        if (selectedQualityBadge) {
            selectedQualityBadge.textContent = opt.badge;
            selectedQualityBadge.className = `quality-badge ${opt.badgeClass || 'badge-sd'}`;
        }
        if (selectedQualityText) {
            selectedQualityText.textContent = opt.name;
        }
        if (selectedQualitySize) {
            selectedQualitySize.textContent = opt.size || 'Ready';
            selectedQualitySize.style.display = opt.size ? 'inline-block' : 'none';
        }

        if (customQualityOptions) {
            const allItems = customQualityOptions.querySelectorAll('.custom-option-item');
            allItems.forEach(el => {
                el.classList.remove('selected');
                el.setAttribute('aria-selected', 'false');
            });
            if (itemEl) {
                itemEl.classList.add('selected');
                itemEl.setAttribute('aria-selected', 'true');
            }
        }
    }

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
            const checkedBoxes = photoGrid.querySelectorAll('.photo-checkbox:checked');
            const checkedCount = checkedBoxes.length;
            
            let hasVideos = false;
            checkedBoxes.forEach(cb => {
                if (cb.getAttribute('data-type') === 'video') {
                    hasVideos = true;
                }
            });

            if (checkedCount === 1) {
                downloadBtnText.textContent = hasVideos ? 'Download Single Video' : 'Download Single Photo';
            } else {
                downloadBtnText.textContent = `Download ${checkedCount} Selected Media`;
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
                images: data.images,
                directUrl: (data.formats && data.formats.length > 0 && data.formats[0].url) ? data.formats[0].url : null
            };

            // Populate Video Info details
            videoThumbnail.src = data.thumbnail;
            videoThumbnail.referrerPolicy = 'no-referrer';
            videoTitle.textContent = data.title;
            videoUploader.textContent = data.uploader;
            if (data.duration) {
                videoDuration.textContent = data.duration;
                videoDuration.style.display = '';
            } else {
                videoDuration.textContent = '';
                videoDuration.style.display = 'none';
            }
            videoPlatformLabel.textContent = data.platform.toUpperCase();

            // Populate selectors and display sizes depending on YouTube vs non-YouTube
            if (data.platform === 'youtube') {
                // YouTube: Show dropdown, hide generic card size tag, hide photo grids
                qualitySelectorBlock.classList.remove('hidden');
                videoFilesizeContainer.classList.add('hidden');
                photoSelectionContainer.classList.add('hidden');
                
                const optionsList = [];

                // Video quality formats
                if (data.formats && data.formats.length > 0) {
                    data.formats.forEach(f => {
                        const h = (f && typeof f === 'object') ? f.height : f;
                        const sizeStr = (f && typeof f === 'object') ? f.size : null;
                        if (!h || h === 'best') return;

                        let name = `${h}p`;
                        let badge = `${h}p`;
                        let badgeClass = 'badge-sd';

                        if (h >= 2160) {
                            name = `4K Ultra HD (${h}p)`;
                            badge = '4K';
                            badgeClass = 'badge-4k';
                        } else if (h >= 1440) {
                            name = `2K Quad HD (${h}p)`;
                            badge = '2K';
                            badgeClass = 'badge-2k';
                        } else if (h >= 1000) {
                            name = `1080p (Full HD)`;
                            badge = '1080p';
                            badgeClass = 'badge-hd';
                        } else if (h >= 900) {
                            name = `960p (High)`;
                            badge = '960p';
                            badgeClass = 'badge-hd';
                        } else if (h >= 700) {
                            name = `720p (HD)`;
                            badge = '720p';
                            badgeClass = 'badge-hd';
                        } else if (h >= 600) {
                            name = `640p (HD)`;
                            badge = '640p';
                            badgeClass = 'badge-hd';
                        } else if (h >= 450) {
                            name = `480p (SD)`;
                            badge = '480p';
                            badgeClass = 'badge-sd';
                        } else if (h >= 400) {
                            name = `428p (SD)`;
                            badge = '428p';
                            badgeClass = 'badge-sd';
                        } else if (h >= 340) {
                            name = `360p (Medium)`;
                            badge = '360p';
                            badgeClass = 'badge-sd';
                        } else if (h >= 300) {
                            name = `320p (Medium)`;
                            badge = '320p';
                            badgeClass = 'badge-sd';
                        } else if (h >= 200) {
                            name = `240p (Low)`;
                            badge = '240p';
                            badgeClass = 'badge-sd';
                        } else {
                            name = `${h}p`;
                            badge = `${h}p`;
                            badgeClass = 'badge-sd';
                        }

                        optionsList.push({
                            value: h,
                            name: name,
                            badge: badge,
                            badgeClass: badgeClass,
                            size: sizeStr
                        });
                    });
                }

                // 3. Audio Only (MP3)
                optionsList.push({
                    value: 'audio',
                    name: 'Audio Only (MP3)',
                    badge: 'MP3',
                    badgeClass: 'badge-audio',
                    size: data.audioSize || null
                });

                setupCustomQualityOptions(optionsList);

            } else {
                // Non-YouTube (TikTok, Instagram, Facebook): Hide quality dropdown, show generic card size tag
                qualitySelectorBlock.classList.add('hidden');
                videoFilesizeContainer.classList.remove('hidden');
                videoFilesizeLabel.textContent = `Estimated Size: ${data.bestSize || 'Unknown'}`;

                if (data.images && data.images.length > 0) {
                    // Photo post: show photos selection container
                    photoSelectionContainer.classList.remove('hidden');
                    photoGrid.innerHTML = '';
                    
                    selectAllPhotos.checked = true;

                    data.images.forEach(img => {
                        const card = document.createElement('div');
                        card.className = 'photo-grid-card';
                        const isVideo = img.type === 'video';
                        const videoOverlay = isVideo ? `
                            <div class="video-overlay-badge" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 2;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                        ` : '';

                        card.innerHTML = `
                            <label class="photo-grid-label" style="position: relative; display: block;">
                                <input type="checkbox" class="photo-checkbox" data-url="${img.url}" data-type="${img.type || 'image'}" checked>
                                <span class="custom-checkbox-ui"></span>
                                <img src="${img.thumbnail || img.url}" referrerpolicy="no-referrer" alt="Slide ${img.index + 1}">
                                ${videoOverlay}
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
                    // Video post: hide photos container
                    photoSelectionContainer.classList.add('hidden');
                    
                    // Prepopulate best format options internally
                    qualitySelect.innerHTML = '';
                    if (data.formats && data.formats.length > 0 && data.formats[0].url) {
                        const option = document.createElement('option');
                        option.value = 'direct';
                        option.dataset.url = data.formats[0].url;
                        qualitySelect.appendChild(option);
                    } else {
                        const bestOption = document.createElement('option');
                        bestOption.value = 'best';
                        qualitySelect.appendChild(bestOption);
                    }
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

    // Helper: Trigger browser file download from a proxy blob stream using POST body payloads
    async function downloadFileFromProxy(url, filename, ext, onProgress) {
        const response = await fetch('/api/mediafetch/download-direct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title: filename, ext })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Direct proxy download failed.');
        }

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

        const reader = response.body.getReader();
        let loadedBytes = 0;
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            loadedBytes += value.length;

            if (totalBytes > 0 && onProgress) {
                const percent = Math.round((loadedBytes / totalBytes) * 100);
                onProgress(percent, loadedBytes, totalBytes);
            }
        }

        const mimeMap = {
            'mp3': 'audio/mpeg',
            'mp4': 'video/mp4',
            'jpg': 'image/jpeg',
            'png': 'image/png',
            'webp': 'image/webp'
        };

        const blob = new Blob(chunks, { type: mimeMap[ext] || 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${filename}.${ext}`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
    }

    // Download Button Action
    downloadBtn.addEventListener('click', async () => {
        if (!currentMediaData) return;

        if (currentMediaData.images && currentMediaData.images.length > 0) {
            // Slideshow download branch (downloading multiple slideshows without ZIP)
            const checkedBoxes = photoGrid.querySelectorAll('.photo-checkbox:checked');
            if (checkedBoxes.length === 0) {
                alert('Please select at least one item to download.');
                return;
            }

            downloadBtn.disabled = true;
            downloadProgress.classList.remove('hidden');

            try {
                for (let i = 0; i < checkedBoxes.length; i++) {
                    const cb = checkedBoxes[i];
                    const url = cb.getAttribute('data-url');
                    const type = cb.getAttribute('data-type') || 'image';
                    const ext = type === 'video' ? 'mp4' : 'jpg';
                    const labelType = type === 'video' ? 'video' : 'photo';
                    
                    const filename = `${currentMediaData.title}_${labelType}_${i + 1}`;
                    
                    updateProgressUI(
                        Math.round((i / checkedBoxes.length) * 100), 
                        `Downloading ${labelType} ${i + 1} of ${checkedBoxes.length}: "${filename}"...`
                    );

                    // Download item using backend proxy
                    await downloadFileFromProxy(url, filename, ext, (percent) => {
                        const basePercent = Math.round((i / checkedBoxes.length) * 100);
                        const progressInStep = Math.round((percent / 100) * (100 / checkedBoxes.length));
                        updateProgressUI(
                            basePercent + progressInStep, 
                            `Downloading ${labelType} ${i + 1} of ${checkedBoxes.length}: ${percent}%`
                        );
                    });

                    // Add a tiny delay to ensure browser sequential download slot works smoothly
                    await new Promise(r => setTimeout(r, 400));
                }

                updateProgressUI(100, 'All items downloaded successfully!');

                setTimeout(() => {
                    downloadBtn.disabled = false;
                    downloadProgress.classList.add('hidden');
                }, 3000);

            } catch (err) {
                console.error('Download failed:', err);
                showError(`Download failed: ${err.message}`);
            }

        } else {
            // Video download branch
            const selectedOption = qualitySelect.options[qualitySelect.selectedIndex];
            const quality = qualitySelect.value;
            const isAudio = quality === 'audio';

            downloadBtn.disabled = true;
            downloadProgress.classList.remove('hidden');

            // If it's a direct link option (e.g. TikWM, Snapsave Facebook direct CDN links)
            const directUrl = (selectedOption && selectedOption.dataset.url) || currentMediaData.directUrl;
            if (quality === 'direct' || directUrl) {
                updateProgressUI(0, 'Connecting to CDN stream...');
                try {
                    await downloadFileFromProxy(directUrl, currentMediaData.title, 'mp4', (percent, loadedBytes, totalBytes) => {
                        const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1);
                        const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                        updateProgressUI(percent, `Downloading video: ${loadedMB}MB of ${totalMB}MB (${percent}%)`);
                    });

                    updateProgressUI(100, 'Download complete!');
                    setTimeout(() => {
                        downloadBtn.disabled = false;
                        downloadProgress.classList.add('hidden');
                    }, 3000);
                } catch (error) {
                    console.error('Direct download failed:', error);
                    showError(`Download failed: ${error.message}`);
                }
                return;
            }

            // Normal backend download logic (via yt-dlp)
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
