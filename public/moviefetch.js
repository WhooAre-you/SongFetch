document.addEventListener('DOMContentLoaded', () => {
    // Search Form & Layout Elements
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-btn');
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    const trendingSection = document.getElementById('trending-section');
    const trendingGrid = document.getElementById('trending-grid');
    const sectionTitle = document.querySelector('.trending-section .section-title');
    const resultSection = document.getElementById('result');
    const errorCard = document.getElementById('error-card');
    const errorMessage = document.getElementById('error-message');

    // Movie Details Elements
    const moviePoster = document.getElementById('movie-poster');
    const movieYear = document.getElementById('movie-year');
    const movieTypeBadge = document.getElementById('movie-type-badge');
    const movieRating = document.getElementById('movie-rating');
    const movieTitle = document.getElementById('movie-title');
    const movieDirector = document.getElementById('movie-director');
    const movieGenre = document.getElementById('movie-genre');
    const moviePlot = document.getElementById('movie-plot');

    // TV Series Selection Elements
    const tvSelectorContainer = document.getElementById('tv-selector-container');
    const seasonSelect = document.getElementById('season-select');
    const episodeSelect = document.getElementById('episode-select');
    const episodesGrid = document.getElementById('episodes-grid');

    // Download Configuration Elements
    const qualitiesList = document.getElementById('qualities-list');
    const subtitlesSelect = document.getElementById('subtitles-select');
    const summaryTitle = document.getElementById('summary-title');
    const summarySize = document.getElementById('summary-size');
    const downloadNowBtn = document.getElementById('download-now-btn');
    
    // Progress Elements
    const playerArea = document.getElementById('player-area');
    const downloadProgress = document.getElementById('download-progress');
    const progressStatus = document.getElementById('progress-status');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');

    // State Variables
    let activeMovieTitle = '';
    let selectedDownloadOption = null;
    let currentSearchResults = [];
    let activeFilter = 'all';

    // Quick Search Thematic Movie Data
    const quickTrending = [
        {
            title: "Inception",
            year: "2010",
            type: "Movie",
            rating: "★ 8.8",
            poster: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&auto=format&fit=crop&q=80"
        },
        {
            title: "Interstellar",
            year: "2014",
            type: "Movie",
            rating: "★ 8.7",
            poster: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=500&auto=format&fit=crop&q=80"
        },
        {
            title: "The Dark Knight",
            year: "2008",
            type: "Movie",
            rating: "★ 9.0",
            poster: "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=500&auto=format&fit=crop&q=80"
        },
        {
            title: "House of the Dragon",
            year: "2022",
            type: "TV Series",
            rating: "★ 8.5",
            poster: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop&q=80"
        }
    ];

    // Helper: Clean and simplify titles to English Name + Date
    function cleanTitle(rawTitle) {
        // Extract year
        let year = '';
        const yearMatch = rawTitle.match(/\b(19\d\d|20\d\d)\b/);
        if (yearMatch) {
            year = yearMatch[1];
        }

        // Strip common Arabic description/noise phrases before removing Arabic chars
        let preClean = rawTitle
            .replace(/مشاهدة وتحميل|مشاهدة|وتحميل|تحميل|مترجم|كامل|اون لاين|بجودة ممتازة|بجودة عالية|بجودة|ممتازة|عالية|مباشر|ممتعة|بدون إعلانات|إعلانات|أعجبني/g, '')
            .replace(/يجمع بين.*$/g, '')  // Cut off description sentences
            .replace(/على\s+\S+\s+سيما.*$/g, '')  // Cut off "على ماي سيما..."
            .replace(/على موقع.*$/g, '')
            .trim();

        // Remove Arabic characters
        let titleClean = preClean.replace(/[\u0600-\u06FF]/g, ' ');

        // Remove common movie metadata noise
        const keywordsToRemove = [
            'watch', 'download', 'full', 'hd', 'bluray', 'web-dl', '1080p', '720p', '480p', 
            'mkv', 'mp4', 'avi', 'yify', 'yts', 'quality', 'resolution', 'server', 'direct',
            'season', 'episode', 'halkat', 'halqa', 'mutarjam', 'arabic', 'english', 'complete',
            'series', 'movie', 'film', 'show', 'episodes', 'seasons', 'translated'
        ];
        
        keywordsToRemove.forEach(kw => {
            const regex = new RegExp(`\\b${kw}\\b`, 'gi');
            titleClean = titleClean.replace(regex, ' ');
        });

        // Remove brackets, parentheses, colons, hyphens, and isolated years
        titleClean = titleClean.replace(/[()\-:\[\]]/g, ' ')
                               .replace(/\b\d{4}\b/g, ' ')
                               .replace(/\s+/g, ' ')
                               .trim();

        // Fallback: If no English words remain, try to extract name from Arabic title
        if (!titleClean || titleClean.length < 3) {
            // Try to extract just the core Arabic movie name (before any description)
            let arabicClean = rawTitle.replace(/مشاهدة|تحميل|كامل|مترجم|اون لاين|بجودة|عالية|فيلم|مسلسل|حلقة|موسم|على|علي|موقع|وي سيما|ماي سيما|أعجبني|ممتازة|مباشر|ممتعة|بدون|إعلانات|يجمع|بين|الكوميديا|الدراما|الاكشن|و\b/g, '')
                                      .replace(/[()\-:\[\]]/g, ' ')
                                      .replace(/\b\d{4}\b/g, ' ')
                                      .replace(/\s+/g, ' ')
                                      .trim();
            // If still too long, take just the first few words
            if (arabicClean.length > 50) {
                arabicClean = arabicClean.split(/\s+/).slice(0, 5).join(' ');
            }
            titleClean = arabicClean;
        }

        // Safety cap: if the title is still unreasonably long, truncate
        if (titleClean.length > 60) {
            titleClean = titleClean.substring(0, 60).trim();
        }

        if (year && !titleClean.includes(year)) {
            return `${titleClean} (${year})`;
        }
        return titleClean;
    }

    // Helper: Extract season number from raw title text or URL
    function extractSeason(rawTitle, link) {
        const arabicOrdinals = { 'الاول': 1, 'الأول': 1, 'الاولى': 1, 'الثاني': 2, 'الثانى': 2, 'الثانية': 2, 'الثالث': 3, 'الثالثة': 3, 'الرابع': 4, 'الرابعة': 4, 'الخامس': 5, 'الخامسة': 5, 'السادس': 6, 'السادسة': 6, 'السابع': 7, 'السابعة': 7, 'الثامن': 8, 'الثامنة': 8, 'التاسع': 9, 'التاسعة': 9, 'العاشر': 10, 'العاشرة': 10 };
        let seasonNum = null;

        // Try from title text
        const titleMatch = rawTitle.match(/(?:الموسم|موسم)\s+(\S+)/);
        if (titleMatch) {
            seasonNum = arabicOrdinals[titleMatch[1]] || parseInt(titleMatch[1]) || null;
        }

        // Try English "Season X"
        if (!seasonNum) {
            const engMatch = rawTitle.match(/Season\s*(\d+)/i);
            if (engMatch) seasonNum = parseInt(engMatch[1]);
        }

        // Try from URL slug (e.g. "الموسم-الرابع" in the path)
        if (!seasonNum && link) {
            const urlDecoded = decodeURIComponent(link);
            const urlMatch = urlDecoded.match(/الموسم[- ](\S+)/);
            if (urlMatch) {
                const cleaned = urlMatch[1].replace(/-/g, '');
                seasonNum = arabicOrdinals[cleaned] || parseInt(cleaned) || null;
            }
        }

        return seasonNum;
    }

    // Helper: Build display title with season for TV series items
    function buildDisplayTitle(item) {
        if (!item || !item.title) return 'Unknown Title';
        // Grouped season cards already have clean Arabic titles — return as-is
        if (item.seasonNumber) {
            const raw = item.title.replace(/مسلسل\s*/g, '').trim();
            return raw;
        }
        let title = cleanTitle(item.title);
        if (classifyItemType(item) === 'series') {
            const season = extractSeason(item.title, item.link || item.id || '');
            if (season) {
                title += ` S${season}`;
            }
        }
        return title || item.title;
    }

    // Initialize Quick Discover Grid
    function initQuickTrending() {
        sectionTitle.textContent = "Trending Discoveries";
        trendingGrid.innerHTML = '';
        currentSearchResults = [];

        quickTrending.forEach(movie => {
            const card = document.createElement('div');
            card.className = 'trending-card';
            card.innerHTML = `
                <div class="trending-poster-wrapper">
                    <img src="${movie.poster}" alt="${movie.title}">
                    <span class="trending-rating-badge">${movie.rating}</span>
                </div>
                <div class="trending-info">
                    <h4>${movie.title}</h4>
                    <p>${movie.year} • ${movie.type}</p>
                </div>
            `;
            
            card.addEventListener('click', () => {
                searchInput.value = movie.title;
                clearBtn.classList.remove('hidden');
                triggerSearch(movie.title);
            });

            trendingGrid.appendChild(card);
        });
    }

    // Helper: Classify result items as movie or series
    function classifyItemType(item) {
        const title = (item.title || '').toLowerCase();
        const url = (item.link || item.id || '').toLowerCase();
        // If backend already flagged as series (grouped season card)
        if (item.isSeries) return 'series';
        if (url.includes('/movie/') || title.includes('فيلم')) {
            return 'movie';
        }
        if (url.includes('/series/') || url.includes('/episode/') || url.includes('watch.php') || title.includes('مسلسل') || title.includes('حلقة') || title.includes('موسم')) {
            return 'series';
        }
        return 'movie'; // fallback
    }

    // Wire up filter pills
    const filterTabs = document.querySelectorAll('.filter-tab');
    filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            filterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeFilter = tab.getAttribute('data-filter');
            renderSearchResults();
        });
    });

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
        initQuickTrending();
    });

    // Reset UI states before a new search
    function resetUI() {
        loader.classList.add('hidden');
        resultSection.classList.add('hidden');
        errorCard.classList.add('hidden');
        tvSelectorContainer.classList.add('hidden');
        downloadProgress.classList.add('hidden');
        downloadNowBtn.disabled = true;
        
        summaryTitle.textContent = '-';
        summarySize.textContent = '-';
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';
        selectedDownloadOption = null;
    }

    // Display error message
    function showError(message) {
        resetUI();
        errorMessage.textContent = message;
        errorCard.classList.remove('hidden');
        errorCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Update download progress UI
    function updateProgressUI(percent, status) {
        progressFill.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressStatus.textContent = status;
    }

    // Search Trigger (queries both standard index and Arabic sites: TopCinema, WeCima, ArabSeed, Movizland, QFilm, Prestige)
    async function triggerSearch(query) {
        resetUI();
        loaderText.textContent = `Searching cinema archives for "${query}"...`;
        loader.classList.remove('hidden');

        try {
            const [stdRes, arabicRes] = await Promise.allSettled([
                fetch(`/api/movies/search?q=${encodeURIComponent(query)}`).then(r => r.ok ? r.json() : { results: [] }),
                fetch('/api/arabic/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                }).then(r => r.ok ? r.json() : { results: [] })
            ]);

            loader.classList.add('hidden');

            const stdResults = (stdRes.status === 'fulfilled' && stdRes.value.results) ? stdRes.value.results : [];
            const arabicResults = (arabicRes.status === 'fulfilled' && arabicRes.value.results) ? arabicRes.value.results.map(r => ({
                id: r.id,
                title: r.title,
                img: r.poster,
                link: r.id || '',
                source: r.sourceName || r.source,
                isArabic: true,
                isSeries: r.isSeries || false,
                seasonNumber: r.seasonNumber || null,
                // Pass grouped season episodes so detail view can show them directly
                groupedEpisodes: r.episodes || null
            })) : [];

            // If Arabic results exist, show ONLY Arabic site results (TopCinema, WeCima, ArabSeed, etc.)!
            // WeFeed fallback is only used if 0 Arabic results are found.
            let combinedResults = [];
            if (arabicResults.length > 0) {
                combinedResults = arabicResults;
            } else {
                combinedResults = stdResults;
            }

            if (combinedResults.length === 0) {
                showError(`No movie or series found matching "${query}". Try another title.`);
                return;
            }

            // Save results and trigger render
            sectionTitle.textContent = `Search Results for "${query}" (${combinedResults.length} found)`;
            currentSearchResults = combinedResults;
            renderSearchResults();

        } catch (err) {
            console.error(err);
            showError(err.message || 'An error occurred during search.');
        }
    }

    // Render search results based on active filters
    function renderSearchResults() {
        trendingGrid.innerHTML = '';

        if (currentSearchResults.length === 0) return;

        const filtered = currentSearchResults.filter(item => {
            const type = classifyItemType(item);
            if (activeFilter === 'all') return true;
            return type === activeFilter;
        });

        if (filtered.length === 0) {
            trendingGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--color-text-muted); padding: 3rem; font-family: var(--font-secondary); font-size: 0.9rem;">No matching ${activeFilter === 'movie' ? 'movies' : 'TV series'} found.</div>`;
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'trending-card';
            
            // Set default poster placeholder if empty or relative
            let posterUrl = item.img;
            if (!posterUrl || typeof posterUrl !== 'string' || posterUrl.trim() === '') {
                posterUrl = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';
            } else if (posterUrl.startsWith('//')) {
                posterUrl = 'https:' + posterUrl;
            }
            
            const sourceName = item.source || 'WeFeed';
            
            // Map site name to distinct vibrant badge background color
            const sourceColorMap = {
                'TopCinema': '#ef4444',
                'WeCima': '#a855f7',
                'WeCima / MyCima': '#a855f7',
                'ArabSeed': '#eab308',
                'Movizland': '#06b6d4',
                'QFilm': '#ec4899',
                'Prestige': '#10b981',
                'WeFeed': '#3b82f6'
            };
            const sourceColor = sourceColorMap[sourceName] || '#9333ea';
            const simplifiedTitle = buildDisplayTitle(item);

            card.innerHTML = `
                <div class="trending-poster-wrapper">
                    <img src="${posterUrl}" alt="${simplifiedTitle}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';">
                    <span class="source-badge" style="background: ${sourceColor};">${sourceName}</span>
                </div>
                <div class="trending-info">
                    <h4>${simplifiedTitle}</h4>
                    <p>${sourceName} Direct Index</p>
                </div>
            `;

            card.addEventListener('click', () => {
                loadWatchDetails(item);
            });

            trendingGrid.appendChild(card);
        });
    }

    // Load watch details
    async function loadWatchDetails(item) {
        resetUI();
        const sourceName = item.source || 'WeFeed';
        loaderText.textContent = `Resolving ${sourceName} mirrors for "${item.title}"...`;
        loader.classList.remove('hidden');

        try {
            let data;
            if (item.isArabic) {
                const res = await fetch('/api/arabic/resolve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: item.link, title: item.title, source: item.source })
                });
                if (!res.ok) throw new Error(`Failed to resolve item details from ${sourceName}.`);
                data = await res.json();
            } else {
                const res = await fetch('/api/movies/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: item.link })
                });
                if (!res.ok) throw new Error(`Failed to parse details page from ${sourceName}.`);
                data = await res.json();
            }
            
            loader.classList.add('hidden');
            let simplifiedTitle = buildDisplayTitle(item);

            activeMovieTitle = simplifiedTitle;

            // Basic metadata displays
            moviePoster.src = item.img || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';
            movieTitle.textContent = simplifiedTitle;
            summaryTitle.textContent = simplifiedTitle;
            
            // Extract clean title name and year for styling
            let year = '2026';
            const yearMatch = item.title.match(/\b(19\d\d|20\d\d)\b/);
            if (yearMatch) year = yearMatch[1];
            movieYear.textContent = year;

            // Set default descriptions
            movieDirector.textContent = `${sourceName} CDN`;
            movieGenre.textContent = classifyItemType(item) === 'movie' ? 'Movie' : 'TV Show';
            movieTypeBadge.textContent = classifyItemType(item) === 'series' ? 'TV SERIES' : 'MOVIE';
            movieRating.textContent = '★ 8.2';
            moviePlot.textContent = `High-speed direct CDN streams served via ${sourceName}. Select your preferred resolution and download quality below to fetch the video file. Optional subtitles can be multiplexed directly into the final container.`;

            // Search metadata helpers to fill in premium English plot/genre details
            if (classifyItemType(item) === 'series') {
                await queryTVmazeMetadata(item.title);
            } else {
                await queryEnglishMetadata(item.title);
            }

            if (data.type === 'series' || (item.groupedEpisodes && item.groupedEpisodes.length > 0)) {
                // Populate TV series selector grid
                tvSelectorContainer.classList.remove('hidden');
                episodesGrid.innerHTML = '';

                // Support TWO episode formats:
                // 1. Grouped season cards: [{id, title, source}]  (from arabicMediaResolver groupSeriesResults)
                // 2. Standard resolved episodes: [{text, link}]   (from resolvePageDetails)
                let rawEpisodes = [];
                if (item.groupedEpisodes && item.groupedEpisodes.length > 0) {
                    // Grouped format — convert to standard {text, link}
                    rawEpisodes = item.groupedEpisodes.map((ep, idx) => ({
                        text: ep.title || `الحلقة ${idx + 1}`,
                        link: ep.id || ep.url || item.link || ''
                    }));
                } else if (data.episodes && data.episodes.length > 0) {
                    rawEpisodes = data.episodes;
                }

                // Parse episode numbers and sort numerically
                const parsedEpisodes = rawEpisodes.map((ep, idx) => {
                    const epText = ep.text || '';
                    const epMatch = epText.match(/(?:حلقة|الحلقة|Episode)\s*(\d+)/i);
                    const epNum = epMatch ? parseInt(epMatch[1]) : (idx + 1);
                    // Always use "Ep. N" format — never strip to raw English noise like "HD"
                    const epLabel = `Ep. ${epNum}`;
                    return { ...ep, epNum, epLabel };
                });

                parsedEpisodes.sort((a, b) => a.epNum - b.epNum);

                // Deduplicate by episode number
                const seen = new Set();
                const uniqueEpisodes = parsedEpisodes.filter(ep => {
                    if (seen.has(ep.epNum)) return false;
                    seen.add(ep.epNum);
                    return true;
                });

                uniqueEpisodes.forEach(ep => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'episode-btn';
                    btn.textContent = ep.epLabel;
                    btn.title = ep.text || ep.epLabel;

                    btn.addEventListener('click', () => {
                        document.querySelectorAll('.episode-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        const fullTitle = `${simplifiedTitle} - ${ep.epLabel}`;
                        loadQualitiesList(ep.link, fullTitle);
                    });

                    episodesGrid.appendChild(btn);
                });

                if (uniqueEpisodes.length > 0) {
                    const firstBtn = episodesGrid.firstChild;
                    if (firstBtn) firstBtn.classList.add('active');
                    loadQualitiesList(uniqueEpisodes[0].link, `${simplifiedTitle} - ${uniqueEpisodes[0].epLabel}`);
                }

            } else {
                // Movie: Render qualities table directly
                renderQualitiesTable(data.downloads);
            }

            resultSection.classList.remove('hidden');
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } catch (err) {
            console.error(err);
            showError(err.message || 'Failed to extract download qualities.');
        }
    }

    // Fetch qualities for selected episode
    async function loadQualitiesList(epUrl, epTitle) {
        qualitiesList.innerHTML = `<tr><td colspan="4" style="text-align:center;">Fetching links for ${epTitle}...</td></tr>`;
        summaryTitle.textContent = epTitle;
        activeMovieTitle = epTitle;
        downloadNowBtn.disabled = true;

        try {
            let data;
            const isArabicEpisode = epUrl && (
                epUrl.includes('prstej.net') ||
                epUrl.includes('wecima') ||
                epUrl.includes('topcinemaa') ||
                epUrl.includes('movizland') ||
                epUrl.includes('qfilm.vip')
            );

            if (isArabicEpisode) {
                // Use yt-dlp to extract the direct video download URL
                qualitiesList.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#a78bfa;">⏳ Extracting video stream with yt-dlp...</td></tr>`;

                const res = await fetch('/api/arabic/extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: epUrl, title: epTitle })
                });

                if (res.ok) {
                    data = await res.json();
                } else {
                    data = { downloads: [] };
                }

                // yt-dlp couldn't extract → fall back to embed player page
                if (!data.downloads || data.downloads.length === 0) {
                    const vidMatch = epUrl.match(/vid=([a-z0-9]+)/i);
                    const embedUrl = vidMatch
                        ? `https://a.prstej.net/embed.php?vid=${vidMatch[1]}`
                        : epUrl;

                    data.downloads = [{
                        quality: '▶ Watch Online (Prestige Player)',
                        url: embedUrl,
                        host: 'a.prstej.net',
                        size: 'Stream'
                    }];
                }
            } else {
                const res = await fetch('/api/movies/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: epUrl })
                });
                if (!res.ok) throw new Error();
                data = await res.json();
            }

            renderQualitiesTable(data.downloads);
        } catch (e) {
            qualitiesList.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f43f5e;">Failed to load server qualities for this episode.</td></tr>`;
        }
    }

    // Render Qualities Table Rows
    function renderQualitiesTable(downloads) {
        qualitiesList.innerHTML = '';

        if (!downloads || downloads.length === 0) {
            qualitiesList.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f43f5e;">No direct download links indexed for this item.</td></tr>`;
            return;
        }

        downloads.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center; vertical-align: middle;">
                    <input type="radio" name="quality-source" value="${index}" id="source-${index}">
                </td>
                <td><strong style="color: #fff;">${item.quality}</strong></td>
                <td style="color: #eab308; font-weight:600;">${item.size}</td>
                <td style="font-family: monospace; font-size:0.8rem; color:#9ca3af;">${item.host}</td>
            `;

            // Bind click to row to auto-select radio
            tr.addEventListener('click', () => {
                const radio = tr.querySelector('input[type="radio"]');
                radio.checked = true;
                
                // Style selection
                document.querySelectorAll('#qualities-list tr').forEach(r => r.classList.remove('selected'));
                tr.classList.add('selected');

                // Update state
                selectedDownloadOption = item;
                summarySize.textContent = item.size;
                downloadNowBtn.disabled = false;
            });

            qualitiesList.appendChild(tr);
        });
    }

    // Helper: Query iTunes Movie API to fetch English plot, genre, and rating
    async function queryEnglishMetadata(arabicTitle) {
        try {
            // Extract English characters from title
            const cleanQuery = arabicTitle.replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!cleanQuery || cleanQuery.length < 3) return;

            const searchUrl = `https://itunes.apple.com/search?media=movie&country=US&term=${encodeURIComponent(cleanQuery)}&limit=1`;
            const res = await fetch(searchUrl);
            const data = await res.json();
            
            if (data.results && data.results.length > 0) {
                const track = data.results[0];
                
                // Update with English details
                movieTitle.textContent = track.trackName;
                movieYear.textContent = new Date(track.releaseDate).getFullYear();
                movieDirector.textContent = `Directed by ${track.artistName}`;
                movieGenre.textContent = track.primaryGenreName;
                
                if (track.longDescription) {
                    moviePlot.textContent = track.longDescription;
                } else if (track.shortDescription) {
                    moviePlot.textContent = track.shortDescription;
                }
                
                if (track.artworkUrl100) {
                    const upscaled = track.artworkUrl100.replace('100x100bb', '600x600bb').replace('100x100', '600x600');
                    moviePoster.src = upscaled;
                }
            }
        } catch (e) {
            console.warn('Metadata query failed:', e.message);
        }
    }

    // Helper: Query TVmaze API to fetch English show summary, rating and genres
    async function queryTVmazeMetadata(title) {
        try {
            // Extract English characters
            const cleanQuery = title.replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!cleanQuery || cleanQuery.length < 3) return;

            const searchUrl = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanQuery)}`;
            const res = await fetch(searchUrl);
            if (!res.ok) return;
            const data = await res.json();
            
            if (data) {
                if (data.name) {
                    movieTitle.textContent = data.name;
                    activeMovieTitle = data.name;
                    summaryTitle.textContent = data.name;
                }
                if (data.summary) {
                    // Remove HTML tags
                    moviePlot.textContent = data.summary.replace(/<[^>]*>/g, '').trim();
                }
                if (data.rating && data.rating.average) {
                    movieRating.textContent = `★ ${data.rating.average}`;
                }
                if (data.genres && data.genres.length > 0) {
                    movieGenre.textContent = data.genres.join(', ');
                }
                if (data.image && data.image.medium) {
                    moviePoster.src = data.image.medium;
                }
            }
        } catch (e) {
            console.warn('TVmaze query failed:', e.message);
        }
    }

    // Execute Search Form Submission
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            triggerSearch(query);
        }
    });

    // Download Movie Button Action - Direct Native Attachment Download
    downloadNowBtn.addEventListener('click', () => {
        if (!selectedDownloadOption) return;

        const videoUrl = selectedDownloadOption.url || selectedDownloadOption.link || selectedDownloadOption.id;
        const movieTitleText = activeMovieTitle || 'movie';

        if (!videoUrl) {
            showError('No valid download URL found for this option.');
            return;
        }

        // If the URL is a stream/embed player page (not a direct video file),
        // open it in a new tab so the user can watch it directly in the browser.
        const isStreamPage = 
            videoUrl.includes('embed.php') ||
            videoUrl.includes('embed.') ||
            videoUrl.includes('player.') ||
            videoUrl.includes('/watch') ||
            (selectedDownloadOption.size === 'Stream');

        if (isStreamPage) {
            // Show inline embedded player instead of opening a new tab
            const modal = document.getElementById('stream-modal');
            const iframe = document.getElementById('stream-iframe');
            const modalTitle = document.getElementById('stream-modal-title');
            if (modal && iframe) {
                modalTitle.textContent = movieTitleText || 'Now Playing';
                iframe.src = videoUrl;
                modal.style.display = 'flex';
            } else {
                window.open(videoUrl, '_blank');
            }
            updateProgressUI(100, '▶ Streaming in player...');
            downloadProgress.classList.remove('hidden');
            return;
        }

        downloadProgress.classList.remove('hidden');
        downloadProgress.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        updateProgressUI(100, 'Direct file download started! Check your browser downloads bar.');

        // Trigger direct native attachment download via GET endpoint
        const streamEndpoint = `/api/movies/stream?url=${encodeURIComponent(videoUrl)}&title=${encodeURIComponent(movieTitleText)}`;
        window.location.href = streamEndpoint;
    });

    // Wire up stream modal close button
    const streamModalClose = document.getElementById('stream-modal-close');
    if (streamModalClose) {
        streamModalClose.addEventListener('click', () => {
            const modal = document.getElementById('stream-modal');
            const iframe = document.getElementById('stream-iframe');
            if (iframe) iframe.src = '';
            if (modal) modal.style.display = 'none';
        });
    }

    // Start with quickdiscover grid
    initQuickTrending();
});
