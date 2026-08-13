// Global Ad / Popup Interceptor
window.open = function(url, target, features) {
    console.warn('[AdBlock] Blocked popup window request to:', url);
    return null;
};

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

    const searchTypeFilters = document.getElementById('search-type-filters');

    // TV Series Selection Elements
    const tvSelectorContainer = document.getElementById('tv-selector-container');
    const seasonsContainer = document.getElementById('seasons-container');
    const seasonsCountBadge = document.getElementById('seasons-count-badge');
    const episodesCountBadge = document.getElementById('episodes-count-badge');
    const episodesGrid = document.getElementById('episodes-grid');

    // Streaming Player Elements
    const playerArea = document.getElementById('player-area');
    const playerTitle = document.getElementById('player-title');
    const playerIframe = document.getElementById('player-iframe');
    const playerVideo = document.getElementById('player-video');
    const serversList = document.getElementById('servers-list');
    const theaterModeBtn = document.getElementById('theater-mode-btn');
    const lightsOutBtn = document.getElementById('lights-out-btn');

    // Create Lights Out Overlay dynamically
    let lightsOutOverlay = document.querySelector('.lights-out-overlay');
    if (!lightsOutOverlay) {
        lightsOutOverlay = document.createElement('div');
        lightsOutOverlay.className = 'lights-out-overlay';
        document.body.appendChild(lightsOutOverlay);
    }

    // State Variables
    let activeMovieTitle = '';
    let currentSearchResults = [];
    let activeFilter = 'all';
    let activeSource = 'all';

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
        if (!rawTitle) return '';
        let year = '';
        const yearMatch = rawTitle.match(/\b(19\d\d|20\d\d)\b/);
        if (yearMatch) year = yearMatch[1];

        // Clean out noise words
        let preClean = rawTitle
            .replace(/مشاهدة وتحميل|مشاهدة|وتحميل|تحميل|مترجم|كامل|اون لاين|اونلاين|بجودة ممتازة|بجودة عالية|بجودة|ممتازة|عالية|مباشر|ممتعة|بدون إعلانات|إعلانات|أعجبني/g, '')
            .replace(/على\s+\S+\s+سيما.*$/g, '')
            .replace(/على موقع.*$/g, '')
            .replace(/يجمع بين.*$/g, '')
            .trim();

        // If the title is Arabic, clean noise while preserving Arabic letters
        const hasArabic = /[\u0600-\u06FF]/.test(preClean);
        let titleClean = preClean;

        if (hasArabic) {
            titleClean = titleClean
                .replace(/فيلم|مسلسل|حلقة|موسم/g, '')
                .replace(/[()\-:\[\]]/g, ' ')
                .replace(/\b\d{4}\b/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        } else {
            // Remove common movie metadata noise for English titles
            const keywordsToRemove = [
                'watch', 'download', 'full', 'hd', 'bluray', 'web-dl', '1080p', '720p', '480p', 
                'mkv', 'mp4', 'avi', 'yify', 'yts', 'quality', 'resolution', 'server', 'direct',
                'season', 'episode', 'complete', 'series', 'movie', 'film'
            ];
            keywordsToRemove.forEach(kw => {
                const regex = new RegExp(`\\b${kw}\\b`, 'gi');
                titleClean = titleClean.replace(regex, ' ');
            });
            titleClean = titleClean.replace(/[()\-:\[\]]/g, ' ').replace(/\b\d{4}\b/g, ' ').replace(/\s+/g, ' ').trim();
        }

        if (!titleClean || titleClean.length < 2) titleClean = rawTitle;
        if (titleClean.length > 60) titleClean = titleClean.substring(0, 60).trim();

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
        if (trendingSection) trendingSection.classList.add('hidden');
        trendingGrid.innerHTML = '';
        currentSearchResults = [];
        
        // Show filters container on page load so sources are always visible!
        const filtersContainer = document.getElementById('filters-container');
        if (filtersContainer) filtersContainer.classList.remove('hidden');

        // Make sure search-type-filters (All Results / Movies / TV Series) are HIDDEN on load!
        if (searchTypeFilters) searchTypeFilters.classList.add('hidden');
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

    // Wire up source filter tabs
    const sourceTabs = document.querySelectorAll('.source-tab');
    sourceTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            sourceTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeSource = tab.getAttribute('data-source');
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
        if (playerArea) playerArea.classList.add('hidden');
        
        // Hide trending section and search-type-filters on reset
        if (searchTypeFilters) searchTypeFilters.classList.add('hidden');
        if (trendingSection) trendingSection.classList.add('hidden');
        if (trendingGrid) trendingGrid.classList.remove('hidden');

        // Stop video players
        if (playerVideo) {
            playerVideo.pause();
            playerVideo.src = '';
        }
        if (playerIframe) {
            playerIframe.src = '';
        }
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

    // Search Trigger (queries IMDb, ArabSeed, QFilm, CimaLight and deduplicates)
    async function triggerSearch(query) {
        resetUI();
        loaderText.textContent = `Searching cinema archives for "${query}"...`;
        loader.classList.remove('hidden');

        try {
            const stdRes = await fetch(`/api/movies/search-all?q=${encodeURIComponent(query)}`).then(r => r.ok ? r.json() : { results: [] });

            loader.classList.add('hidden');

            const combinedResults = stdRes.results || [];

            if (combinedResults.length === 0) {
                showError(`No movie or series found matching "${query}". Try another title.`);
                return;
            }

            // Save results and trigger render
            sectionTitle.textContent = `Search Results for "${query}" (${combinedResults.length} found)`;
            currentSearchResults = combinedResults;
            
            // Show filters container, search-type-filters and trendingSection results area
            const filtersContainer = document.getElementById('filters-container');
            if (filtersContainer) filtersContainer.classList.remove('hidden');
            if (searchTypeFilters) searchTypeFilters.classList.remove('hidden');
            if (trendingSection) trendingSection.classList.remove('hidden');

            resultSection.classList.remove('hidden');
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
            const typeMatch = (activeFilter === 'all' || type === activeFilter);
            
            if (!typeMatch) return false;
            if (activeSource === 'all') return true;
            const itemSource = (item.source || '').toLowerCase();
            if (activeSource === 'vidsrc') return itemSource.includes('vidsrc') || itemSource.includes('wefeed');
            return true;
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
            
            // Generate source badges summary (e.g. "ArabSeed • QFilm • VidSrc")
            let sourcesSummary = 'VidSrc';
            if (item.sources && item.sources.length > 0) {
                sourcesSummary = item.sources.map(s => s.sourceName).join(' • ');
            } else if (item.sourceName) {
                sourcesSummary = item.sourceName;
            }

            const simplifiedTitle = buildDisplayTitle(item);

            card.innerHTML = `
                <div class="trending-poster-wrapper">
                    <img src="${posterUrl}" alt="${simplifiedTitle}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';">
                    <span class="source-badge" style="background: linear-gradient(135deg, #f59e0b, #ef4444);">${sourcesSummary}</span>
                </div>
                <div class="trending-info">
                    <h4>${simplifiedTitle}</h4>
                    <p>المصادر: ${sourcesSummary}</p>
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
            // English content: set metadata directly (IMDb ID mapping)
            data = {
                type: (classifyItemType(item) === 'series' || item.isSeries) ? 'series' : 'movie',
                imdbId: item.imdbId || item.link,
                title: item.title
            };
            
            loader.classList.add('hidden');
            let simplifiedTitle = buildDisplayTitle(item);

            activeMovieTitle = simplifiedTitle;

            // Basic metadata displays
            moviePoster.src = item.img || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';
            movieTitle.textContent = simplifiedTitle;
            
            // Extract clean title name and year for styling
            let year = '2026';
            const yearMatch = item.title.match(/\b(19\d\d|20\d\d)\b/);
            if (yearMatch) year = yearMatch[1];
            movieYear.textContent = year;

            // Set default descriptions
            movieDirector.textContent = '';
            movieGenre.textContent = classifyItemType(item) === 'movie' ? 'Movie' : 'TV Show';
            if (movieTypeBadge) movieTypeBadge.textContent = classifyItemType(item) === 'series' ? 'TV SERIES' : 'MOVIE';
            if (movieRating) movieRating.textContent = '';
            moviePlot.textContent = '';
            
            // Search metadata helpers to fill in premium English plot/genre details
            let metaData = null;
            if (classifyItemType(item) === 'series') {
                metaData = await queryTVmazeMetadata(item.title);
                if (metaData && !item.isArabic) {
                    data = metaData; // use TVmaze show data for english series
                }
            } else {
                await queryEnglishMetadata(item.title);
            }

            // Check if it's a TV series
            const isTV = (classifyItemType(item) === 'series' || data.type === 'series');

            if (isTV) {
                tvSelectorContainer.classList.remove('hidden');
                seasonsContainer.innerHTML = '';
                episodesGrid.innerHTML = '';
                
                let seasonsList = [];

                // English TV Show from TVmaze
                if (data._embedded && data._embedded.episodes) {
                    const seasonsMap = {};
                    data._embedded.episodes.forEach(ep => {
                        const se = ep.season || 1;
                        const epNum = ep.number || 1;
                        if (!seasonsMap[se]) {
                            seasonsMap[se] = {
                                number: se,
                                title: `الموسم ${se} / Season ${se}`,
                                url: '',
                                episodes: []
                            };
                        }
                        seasonsMap[se].episodes.push({
                            number: epNum,
                            title: ep.name || `Episode ${epNum}`,
                            url: '' // Built dynamically with imdb id
                        });
                    });
                    seasonsList = Object.values(seasonsMap).sort((a, b) => a.number - b.number);
                }

                // Render Seasons cards (Netflix-style)
                seasonsContainer.innerHTML = '';
                seasonsCountBadge.textContent = seasonsList.length;

                seasonsList.forEach((season, idx) => {
                    const card = document.createElement('div');
                    card.className = 'season-card';
                    if (idx === 0) card.classList.add('active');
                    
                    const posterSrc = item.img || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';
                    card.innerHTML = `
                        <img src="${posterSrc}" alt="${season.title}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';">
                        <div class="season-card-info">
                            <h5>${season.title}</h5>
                        </div>
                    `;
                    
                    card.addEventListener('click', () => {
                        document.querySelectorAll('.season-card').forEach(c => c.classList.remove('active'));
                        card.classList.add('active');
                        renderEpisodesList(season, item, data);
                    });
                    
                    seasonsContainer.appendChild(card);
                });

                // Auto-select first season card
                if (seasonsList.length > 0) {
                    renderEpisodesList(seasonsList[0], item, data);
                }

            } else {
                // Standalone Movie: Play stream directly
                playMovieStream(data, item);
            }

            // Hide search results to focus on player
            if (trendingSection) trendingSection.classList.add('hidden');

            resultSection.classList.remove('hidden');
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } catch (err) {
            console.error(err);
            showError(err.message || 'Failed to extract streaming details.');
        }
    }

    // Render Episodes Grid
    async function renderEpisodesList(season, parentItem, parentData) {
        episodesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #eab308; padding: 1rem;">⏳ Loading episodes...</div>';
        
        try {
            let episodes = [];
            
            if (season.episodes && season.episodes.length > 0) {
                episodes = season.episodes;
            }

            const parsedEpisodes = episodes.map((ep, idx) => {
                const epNum = ep.number || idx + 1;
                return {
                    number: epNum,
                    title: `حلقة ${epNum}`,
                    url: ep.url || ep.link || ''
                };
            }).sort((a, b) => a.number - b.number);

            const seen = new Set();
            const uniqueEpisodes = parsedEpisodes.filter(ep => {
                if (seen.has(ep.number)) return false;
                seen.add(ep.number);
                return true;
            });

            episodesGrid.innerHTML = '';
            episodesCountBadge.textContent = uniqueEpisodes.length;

            if (uniqueEpisodes.length === 0) {
                episodesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 1rem;">No episodes available.</div>';
                return;
            }

            uniqueEpisodes.forEach(ep => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'episode-btn';
                btn.textContent = `الحلقة ${ep.number}`;
                btn.title = ep.title;

                btn.addEventListener('click', () => {
                    document.querySelectorAll('.episode-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    playEpisodeStream(ep, season.number, parentItem, parentData);
                });

                episodesGrid.appendChild(btn);
            });

            // Auto-click first episode
            if (episodesGrid.firstChild) {
                episodesGrid.firstChild.click();
            }

        } catch (e) {
            console.error(e);
            episodesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444; padding: 1rem;">Failed to load episodes.</div>';
        }
    }


    // Play Movie Streams
    async function playMovieStream(details, parentItem) {
        playerArea.classList.remove('hidden');
        playerTitle.textContent = `Streaming: ${activeMovieTitle}`;
        serversList.innerHTML = '<div style="color: #eab308;">⏳ Resolving streaming links...</div>';
        
        let servers = [];

        // Resolve servers from aggregated sources list (ArabSeed, QFilm, CimaLight, VidSrc)
        const sourcesToResolve = parentItem.sources || (parentItem.link ? [{ source: parentItem.source || 'vidsrc', sourceName: parentItem.sourceName || 'VidSrc', link: parentItem.link, imdbId: parentItem.imdbId }] : []);

        if (sourcesToResolve.length > 0) {
            try {
                const sres = await fetch('/api/movies/resolve-servers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sources: sourcesToResolve })
                });
                if (sres.ok) {
                    const sdata = await sres.json();
                    if (sdata.servers && sdata.servers.length > 0) {
                        servers = servers.concat(sdata.servers);
                    }
                }
            } catch (err) {
                console.error('Failed to resolve servers:', err);
            }
        }

        // Fallback VidSrc provider if no servers found or missing VidSrc
        const idToUse = parentItem.tmdbId || parentItem.imdbId || details.imdbId;
        if (idToUse && !servers.some(s => s.name.includes('VidLink'))) {
            servers.unshift(
                { name: "✨ VidLink (بدون إعلانات 1080p)", url: `https://vidlink.pro/movie/${idToUse}`, type: 'iframe' },
                { name: "✨ VidSrc.pro (بدون إعلانات HD)", url: `https://vidsrc.pro/embed/movie/${idToUse}`, type: 'iframe' },
                { name: "🎬 SmashyStream (بدون إعلانات)", url: `https://embed.smashystream.com/playere.php?tmdb=${idToUse}`, type: 'iframe' },
                { name: "🎬 AutoEmbed", url: `https://player.autoembed.cc/embed/movie/${idToUse}`, type: 'iframe' },
                { name: "🎬 2Embed", url: `https://2embed.cc/embed/${idToUse}`, type: 'iframe' }
            );
        }

        renderServerButtons(servers);
    }

    // Play Episode Streams
    async function playEpisodeStream(ep, seasonNum, parentItem, parentData) {
        playerArea.classList.remove('hidden');
        playerTitle.textContent = `Streaming: ${activeMovieTitle} - S${seasonNum}E${ep.number}`;
        serversList.innerHTML = '<div style="color: #eab308;">⏳ Resolving streaming links...</div>';
        
        let servers = [];

        const idToUse = parentItem.tmdbId || parentItem.imdbId || (parentItem.externals && parentItem.externals.imdb) || (parentData && parentData.externals && parentData.externals.imdb);

        if (idToUse) {
            servers.push(
                { name: "✨ VidLink (بدون إعلانات 1080p)", url: `https://vidlink.pro/tv/${idToUse}/${seasonNum}/${ep.number}`, type: 'iframe' },
                { name: "✨ VidSrc.pro (بدون إعلانات HD)", url: `https://vidsrc.pro/embed/tv/${idToUse}/${seasonNum}/${ep.number}`, type: 'iframe' },
                { name: "🎬 SmashyStream (بدون إعلانات)", url: `https://embed.smashystream.com/playere.php?tmdb=${idToUse}&season=${seasonNum}&episode=${ep.number}`, type: 'iframe' },
                { name: "🎬 2Embed", url: `https://2embed.cc/embed/${idToUse}/${seasonNum}/${ep.number}`, type: 'iframe' }
            );
        }

        renderServerButtons(servers);
    }

    // Render Server Buttons and set click triggers
    function renderServerButtons(servers) {
        serversList.innerHTML = '';
        
        if (servers.length === 0) {
            serversList.innerHTML = '<div style="color: #ef4444;">No watch links available. Choose another source.</div>';
            return;
        }

        servers.forEach((srv, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'server-tab';
            btn.textContent = srv.name;
            if (idx === 0) btn.classList.add('active');

            btn.addEventListener('click', () => {
                document.querySelectorAll('.server-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                if (srv.type === 'iframe') {
                    playerVideo.style.display = 'none';
                    playerVideo.pause();
                    playerIframe.style.display = 'block';
                    playerIframe.src = srv.url;
                } else if (srv.type === 'video') {
                    playerIframe.style.display = 'none';
                    playerIframe.src = '';
                    playerVideo.style.display = 'block';
                    playerVideo.src = srv.url;
                    playerVideo.play().catch(() => {});
                }
            });

            serversList.appendChild(btn);
        });

        // Trigger first server click
        if (serversList.firstChild) {
            serversList.firstChild.click();
        }
    }

    // Load Ostora Live TV Feeds
    async function loadOstoraLiveChannels() {
        trendingGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444; padding: 2rem;">⏳ Loading Ostora Live TV Feeds...</div>';
        try {
            const res = await fetch('/api/ostora/channels');
            if (!res.ok) throw new Error();
            const data = await res.json();
            
            trendingGrid.innerHTML = '';
            data.channels.forEach(ch => {
                const card = document.createElement('div');
                card.className = 'trending-card';
                
                card.innerHTML = `
                    <div class="trending-poster-wrapper">
                        <img src="https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=500&auto=format&fit=crop&q=80" alt="${ch.name}" style="object-fit: cover;">
                        <span class="source-badge" style="background: #ef4444;">📺 Ostora Live</span>
                    </div>
                    <div class="trending-info">
                        <h4>${ch.name}</h4>
                        <p>Category: ${ch.category}</p>
                    </div>
                `;
                
                card.addEventListener('click', () => {
                    playOstoraChannel(ch);
                });
                trendingGrid.appendChild(card);
            });
        } catch (e) {
            trendingGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 2rem;">Failed to fetch Ostora TV live feeds.</div>';
        }
    }

    // Play Ostora Live channels
    function playOstoraChannel(channel) {
        playerArea.classList.remove('hidden');
        playerTitle.textContent = `Ostora Live TV: ${channel.name}`;
        serversList.innerHTML = '';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'server-tab active';
        btn.textContent = '📺 Live Main Stream';

        btn.addEventListener('click', () => {
            if (channel.isEmbed) {
                playerVideo.style.display = 'none';
                playerVideo.pause();
                playerIframe.style.display = 'block';
                playerIframe.src = channel.embedUrl;
            } else {
                playerIframe.style.display = 'none';
                playerIframe.src = '';
                playerVideo.style.display = 'block';
                playerVideo.src = channel.url;
                playerVideo.play().catch(() => {});
            }
        });

        serversList.appendChild(btn);
        btn.click();
        playerArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Wire up player custom controllers (Theater Mode, Lights out)
    if (theaterModeBtn) {
        theaterModeBtn.addEventListener('click', () => {
            playerArea.classList.toggle('theater-mode-active');
            theaterModeBtn.textContent = playerArea.classList.contains('theater-mode-active') ? '🎬 Normal Mode' : '🎭 Theater Mode';
        });
    }

    if (lightsOutBtn) {
        lightsOutBtn.addEventListener('click', () => {
            document.body.classList.toggle('lights-out-active');
            lightsOutBtn.textContent = document.body.classList.contains('lights-out-active') ? '💡 Lights On' : '💡 Lights Out';
        });
    }

    // Helper: Query TVmaze API to fetch English show metadata AND embed episodes
    async function queryTVmazeMetadata(title) {
        try {
            const cleanQuery = title.replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!cleanQuery || cleanQuery.length < 3) return null;

            const searchUrl = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanQuery)}&embed=episodes`;
            const res = await fetch(searchUrl);
            if (!res.ok) return null;
            const data = await res.json();
            
            if (data) {
                if (data.name) {
                    movieTitle.textContent = data.name;
                    activeMovieTitle = data.name;
                }
                if (data.summary) {
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
                return data;
            }
        } catch (e) {
            console.warn('TVmaze query failed:', e.message);
        }
        return null;
    }

    // Query OMDB / IMDB API for English movie metadata (plot, director, rating, genre)
    async function queryEnglishMetadata(title) {
        try {
            const cleanQuery = title.replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!cleanQuery || cleanQuery.length < 2) return;

            // First try to get IMDB ID from our backend
            let imdbId = null;
            try {
                const imdbRes = await fetch('/api/movies/imdb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: cleanQuery })
                });
                if (imdbRes.ok) {
                    const imdbData = await imdbRes.json();
                    imdbId = imdbData.imdbId;
                }
            } catch (e) { /* ignore */ }

            // Use OMDB API to get metadata (free tier with API key)
            const omdbKey = '3e974fca'; // Free OMDB API key
            let omdbUrl = imdbId 
                ? `https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}&plot=short`
                : `https://www.omdbapi.com/?t=${encodeURIComponent(cleanQuery)}&apikey=${omdbKey}&plot=short`;
            
            const res = await fetch(omdbUrl);
            if (!res.ok) return;
            const data = await res.json();
            
            if (data && data.Response === 'True') {
                if (data.Title) {
                    movieTitle.textContent = data.Title;
                    activeMovieTitle = data.Title;
                }
                if (data.Plot && data.Plot !== 'N/A') {
                    moviePlot.textContent = data.Plot;
                }
                if (data.Director && data.Director !== 'N/A') {
                    movieDirector.textContent = `Directed by ${data.Director}`;
                }
                if (data.imdbRating && data.imdbRating !== 'N/A') {
                    movieRating.textContent = `★ ${data.imdbRating}`;
                }
                if (data.Genre && data.Genre !== 'N/A') {
                    movieGenre.textContent = data.Genre;
                }
                if (data.Year && data.Year !== 'N/A') {
                    movieYear.textContent = data.Year;
                }
                if (data.Poster && data.Poster !== 'N/A' && !moviePoster.src.includes('imdb')) {
                    moviePoster.src = data.Poster;
                }
            }
        } catch (e) {
            console.warn('English metadata query failed:', e.message);
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

    // Start with quickdiscover grid
    initQuickTrending();
});
