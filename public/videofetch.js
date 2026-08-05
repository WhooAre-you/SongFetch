document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-btn');
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    const resultSection = document.getElementById('result');
    const errorCard = document.getElementById('error-card');
    const errorMessage = document.getElementById('error-message');

    // Video details card elements
    const videoThumbnail = document.getElementById('video-thumbnail');
    const videoTitle = document.getElementById('video-title');
    const videoUploader = document.getElementById('video-uploader');
    const videoDuration = document.getElementById('video-duration');
    const videoPlatformLabel = document.getElementById('video-platform-label');
    const qualitySelect = document.getElementById('quality-select');

    // Download elements
    const downloadBtn = document.getElementById('download-btn');
    const downloadProgress = document.getElementById('download-progress');
    const progressStatus = document.getElementById('progress-status');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');

    let currentVideoData = null;

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
                                urlLower.includes('tiktok.com');

        if (!isValidPlatform) {
            showError('Please paste a valid video URL from YouTube, Instagram, or TikTok.');
            return;
        }

        try {
            const response = await fetch('/api/videofetch/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to extract video details.');
            }

            const data = await response.json();
            currentVideoData = {
                url: url,
                title: data.title,
                thumbnail: data.thumbnail,
                duration: data.duration,
                uploader: data.uploader,
                platform: data.platform,
                formats: data.formats
            };

            // Populate Video Info details
            videoThumbnail.src = data.thumbnail;
            videoTitle.textContent = data.title;
            videoUploader.textContent = data.uploader;
            videoDuration.textContent = data.duration;
            videoPlatformLabel.textContent = data.platform.toUpperCase();

            // Populate Quality Options
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
                // TikTok and Instagram only download in Best Quality
                const bestOption = document.createElement('option');
                bestOption.value = 'best';
                const sizeStr = (data.formats && data.formats[0]) ? data.formats[0].size : data.bestSize;
                bestOption.textContent = `Best Quality (Watermark-Free)${sizeStr ? ` - ${sizeStr}` : ''}`;
                qualitySelect.appendChild(bestOption);
            }

            // Reveal results
            loader.classList.add('hidden');
            resultSection.classList.remove('hidden');
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } catch (error) {
            console.error('Info fetching error:', error);
            showError(error.message || 'An error occurred while fetching video info.');
        }
    });

    // Download Button Action
    downloadBtn.addEventListener('click', async () => {
        if (!currentVideoData) return;

        const quality = qualitySelect.value;
        const isAudio = quality === 'audio';

        downloadBtn.disabled = true;
        downloadProgress.classList.remove('hidden');
        updateProgressUI(0, 'Initializing downloader...');

        // Smooth simulated progress bar stages (0% - 90%)
        let simulatedProgress = 0;
        const simulatedInterval = setInterval(() => {
            if (simulatedProgress < 90) {
                // Accelerate progress up to 90%
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
            const response = await fetch('/api/videofetch/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: currentVideoData.url,
                    quality: quality,
                    title: currentVideoData.title
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
                    // Map remaining 10% progress during actual delivery
                    const downloadPercent = Math.round((loadedBytes / totalBytes) * 10);
                    const totalPercent = 90 + downloadPercent;
                    const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1);
                    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                    updateProgressUI(totalPercent, `Downloading: ${loadedMB}MB of ${totalMB}MB...`);
                }
            }

            updateProgressUI(100, 'Download complete!');

            // Convert gathered stream chunks to a browser download
            const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';
            const blob = new Blob(chunks, { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = blobUrl;
            
            const ext = isAudio ? 'mp3' : 'mp4';
            const safeFilename = `${currentVideoData.title}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
            
            a.download = safeFilename;
            document.body.appendChild(a);
            a.click();
            
            // Clean up resources
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);

            // Re-enable download button
            setTimeout(() => {
                downloadBtn.disabled = false;
                downloadProgress.classList.add('hidden');
            }, 3000);

        } catch (error) {
            clearInterval(simulatedInterval);
            console.error('Video download failed:', error);
            showError(`Download failed: ${error.message}`);
        }
    });
});
