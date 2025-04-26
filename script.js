document.addEventListener('DOMContentLoaded', () => {
    const uploadInput = document.getElementById('ebook-upload');
    const readerSection = document.getElementById('reader-section');
    const flashWordDiv = document.getElementById('flash-word');
    const playPauseButton = document.getElementById('play-pause');
    const wpmSlider = document.getElementById('wpm-slider');
    const wpmValueSpan = document.getElementById('wpm-value');
    const statusArea = document.getElementById('status-area');
    const chapterListContainer = document.getElementById('chapter-list-container');
    const chapterList = document.getElementById('chapter-list');

    let words = [];
    let currentWordIndex = 0;
    let isPlaying = false;
    let intervalId = null;
    let fullBookText = '';
    let chapterData = [];

    uploadInput.addEventListener('change', handleFileUpload);
    playPauseButton.addEventListener('click', togglePlayPause);
    wpmSlider.addEventListener('input', handleWpmChange);
    chapterList.addEventListener('click', handleChapterClick);

    function logStatus(message, isError = false) {
        console.log(`Status: ${message}` + (isError ? ' (Error)' : ''));
        statusArea.textContent = message;
        statusArea.style.color = isError ? 'red' : '#333';
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        logStatus(`File selected: ${file.name} (${file.type})`);
        resetReader();
        chapterList.innerHTML = '';
        chapterListContainer.style.display = 'none';
        readerSection.style.display = 'none';
        chapterData = [];

        if (file.type === 'application/pdf') {
            logStatus('Parsing PDF...');
            parsePdf(file);
        } else if (file.type === 'application/epub+zip') {
             logStatus('Parsing EPUB...');
            parseEpub(file);
        } else {
            logStatus('Unsupported file type. Please upload PDF or EPUB.', true);
        }
    }

    async function parsePdf(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const typedArray = new Uint8Array(e.target.result);
            let pdf = null;
            try {
                pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                logStatus(`PDF loaded: ${pdf.numPages} pages. Extracting text and outline...`);

                let textPerPage = [];
                fullBookText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    textPerPage.push(pageText);
                    fullBookText += pageText + '\n';
                }
                logStatus(`PDF text extracted. Processing outline...`);

                const outline = await pdf.getOutline();
                chapterData = [];
                if (outline && outline.length > 0) {
                     const processOutline = async (outlineItems) => {
                        for (const item of outlineItems) {
                            await processOutlineItem(item, 0, pdf, textPerPage);
                        }
                     };

                    const processOutlineItem = async (item, level, pdfDoc, pageTexts) => {
                        let targetPageIndex = -1;
                        try {
                             if (item.dest && Array.isArray(item.dest) && item.dest.length > 0 && typeof item.dest[0] === 'object' && item.dest[0] !== null && 'num' in item.dest[0]){
                                const pageRef = item.dest[0];
                                targetPageIndex = await pdfDoc.getPageIndex(pageRef);
                            } else if (item.dest && typeof item.dest === 'string') {
                                const dest = await pdfDoc.getDestination(item.dest);
                                if (dest && Array.isArray(dest) && dest.length > 0 && typeof dest[0] === 'object' && dest[0] !== null && 'num' in dest[0]) {
                                    targetPageIndex = await pdfDoc.getPageIndex(dest[0]);
                                }
                            }
                        } catch (err) {
                             console.warn(`Could not get page index for outline item '${item.title}':`, err);
                        }

                        let startWordIndex = -1;
                        if (targetPageIndex >= 0 && targetPageIndex < pageTexts.length) {
                            let currentWordCount = 0;
                             for(let i=0; i < targetPageIndex; i++) {
                                currentWordCount += pageTexts[i].split(/\s+/).filter(w => w.length > 0).length + (i > 0 ? 1 : 0);
                             }
                             startWordIndex = currentWordCount;
                        } else {
                             console.warn(`Could not map outline item '${item.title}' to a valid page index (${targetPageIndex}).`);
                        }

                        chapterData.push({
                            title: item.title,
                            level: level,
                            target: item.dest,
                            startWordIndex: startWordIndex
                        });

                        if (item.items && item.items.length > 0) {
                            for (const subItem of item.items) {
                                await processOutlineItem(subItem, level + 1, pdfDoc, pageTexts);
                            }
                        }
                    };

                     await processOutline(outline);

                    logStatus("PDF outline processed.");
                    displayChapters(chapterData);
                } else {
                    logStatus("No outline (chapters) found in this PDF.");
                }

                setupReader(fullBookText);
                readerSection.style.display = 'block';

            } catch (error) {
                console.error('Error parsing PDF:', error);
                logStatus(`Error parsing PDF: ${error.message}`, true);
                readerSection.style.display = 'none';
                chapterListContainer.style.display = 'none';
            }
        };
        reader.onerror = (e) => {
            console.error('FileReader error:', e);
            logStatus('Error reading file.', true);
            readerSection.style.display = 'none';
            chapterListContainer.style.display = 'none';
        }
        reader.readAsArrayBuffer(file);
    }

    async function parseEpub(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            let book = null;
            let hiddenDiv = document.getElementById('epub-render-area');
            try {
                book = ePub(arrayBuffer);
                logStatus("EPUB loaded. Rendering (hidden) to extract text and ToC...");

                if (!hiddenDiv) {
                    hiddenDiv = document.createElement('div');
                    hiddenDiv.id = 'epub-render-area';
                    hiddenDiv.style.display = 'none';
                    document.body.appendChild(hiddenDiv);
                }
                const rendition = book.renderTo(hiddenDiv.id, { width: 600, height: 400 });
                await book.ready;
                if (book.spine && book.spine.items.length > 0) {
                    await rendition.display(book.spine.items[0].href);
                } else {
                    await rendition.display();
                }
                await book.locations.generate(1000);

                logStatus("EPUB rendered. Extracting text and ToC...");

                fullBookText = '';
                let cumulativeWordCount = 0;
                const sectionStartIndices = {};

                for (const section of book.spine.items) {
                    const canonicalHref = book.canonical(section.href).split('#')[0];
                    if (!(canonicalHref in sectionStartIndices)) {
                        sectionStartIndices[canonicalHref] = cumulativeWordCount;
                    }

                    const contents = await book.load(section.href);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = contents;
                    const sectionText = (tempDiv.textContent || tempDiv.innerText || '').trim();
                    const sectionWords = sectionText.split(/\s+/).filter(w => w.length > 0);

                    fullBookText += sectionText + '\n\n';
                    cumulativeWordCount += sectionWords.length + (cumulativeWordCount > 0 ? 2 : 0);
                }

                logStatus(`EPUB text extracted. Processing ToC...`);

                chapterData = [];
                if (book.navigation && book.navigation.toc && book.navigation.toc.length > 0) {

                    const processTocItem = (item, level) => {
                         const canonicalHref = book.canonical(item.href).split('#')[0];
                         const startWordIndex = sectionStartIndices[canonicalHref];

                         if (typeof startWordIndex === 'number') {
                             chapterData.push({
                                title: item.label.trim(),
                                level: level,
                                target: item.href,
                                startWordIndex: startWordIndex
                            });
                         } else {
                             console.warn(`Could not find start index for ToC item: ${item.label.trim()} (href: ${item.href}, canonical: ${canonicalHref})`);
                         }

                        if (item.subitems && item.subitems.length > 0) {
                            item.subitems.forEach(subItem => processTocItem(subItem, level + 1));
                        }
                    };
                    book.navigation.toc.forEach(item => processTocItem(item, 0));

                    logStatus("EPUB ToC processed.");
                    displayChapters(chapterData);
                } else {
                    logStatus("No ToC (chapters) found in this EPUB.");
                }

                setupReader(fullBookText);

            } catch (error) {
                console.error('Error parsing EPUB:', error);
                logStatus(`Error parsing EPUB: ${error.message}`, true);
                readerSection.style.display = 'none';
                chapterListContainer.style.display = 'none';
            } finally {
                 if (hiddenDiv) {
                    hiddenDiv.remove();
                 }
                 if (book && typeof book.destroy === 'function') {
                    book.destroy();
                 }
            }
        };
        reader.onerror = (e) => {
            console.error('FileReader error:', e);
            logStatus('Error reading file.', true);
            readerSection.style.display = 'none';
            chapterListContainer.style.display = 'none';
        }
        reader.readAsArrayBuffer(file);
    }

    function setupReader(text, startIndex = 0) {
        fullBookText = text;
        words = fullBookText.split(/\s+/).filter(word => word.length > 0);
        currentWordIndex = (startIndex >= 0 && startIndex < words.length) ? startIndex : 0;

        if (words.length > 0) {
             readerSection.style.display = 'block';
             flashWord();
             logStatus(`Ready to read: ${words.length} words loaded.`);
        } else {
            readerSection.style.display = 'none';
            chapterListContainer.style.display = 'none';
            flashWordDiv.textContent = '';
             if (text && text.trim().length > 0) {
                logStatus("Content loaded, but no words were extracted.", true);
             } else {
                 logStatus("No content loaded or content is empty.");
             }
        }
    }

    function resetReader() {
        stopReading();
        currentWordIndex = 0;
        words = [];
        fullBookText = '';
        flashWordDiv.textContent = '';
        playPauseButton.textContent = 'Play';
    }

    function togglePlayPause() {
        if (isPlaying) {
            stopReading();
        } else {
            startReading();
        }
    }

    function startReading() {
        if (words.length === 0 || currentWordIndex >= words.length) {
             logStatus(currentWordIndex >= words.length ? "End of content reached." : "No content loaded.");
             stopReading();
             return;
        }
        isPlaying = true;
        playPauseButton.textContent = 'Pause';
        scheduleNextWord();
        console.log('Playing');
    }

    function stopReading() {
        isPlaying = false;
        playPauseButton.textContent = 'Play';
        if (intervalId) {
            clearTimeout(intervalId);
            intervalId = null;
        }
        console.log('Paused');
    }

    function scheduleNextWord() {
        if (!isPlaying) {
            return;
        }

        flashWord();

        const wpm = parseInt(wpmSlider.value, 10);
        const delay = 60000 / wpm;

        intervalId = setTimeout(() => {
            currentWordIndex++;

            if (currentWordIndex >= words.length) {
                logStatus("Finished reading.");
                stopReading();
                flashWordDiv.textContent = '';
            } else if (isPlaying) {
                scheduleNextWord();
            }
        }, delay);
    }

    function flashWord() {
         if (currentWordIndex < words.length) {
            flashWordDiv.textContent = words[currentWordIndex];

            let currentActiveLi = null;
            let bestMatchIndex = -1;

            for (let i = 0; i < chapterData.length; i++) {
                if (typeof chapterData[i].startWordIndex === 'number' && chapterData[i].startWordIndex >= 0 && chapterData[i].startWordIndex <= currentWordIndex) {
                    if (bestMatchIndex === -1 || chapterData[i].startWordIndex >= chapterData[bestMatchIndex].startWordIndex) {
                        bestMatchIndex = i;
                    }
                }
            }

            if (bestMatchIndex !== -1) {
                const targetWordIndex = chapterData[bestMatchIndex].startWordIndex;
                currentActiveLi = chapterList.querySelector(`li[data-word-index="${targetWordIndex}"]`);
            }

            const previouslyActiveLi = chapterList.querySelector('li.active');

            if (currentActiveLi && currentActiveLi !== previouslyActiveLi) {
                if(previouslyActiveLi) previouslyActiveLi.classList.remove('active');
                currentActiveLi.classList.add('active');
            } else if (!currentActiveLi && previouslyActiveLi) {
                previouslyActiveLi.classList.remove('active');
            }

        } else {
             flashWordDiv.textContent = '';
             if (isPlaying) stopReading();
        }
    }

    function updateSpeed() {
        if (isPlaying) {
            stopReading();
            startReading();
        }
        console.log(`Speed updated to ${wpmSlider.value} WPM`);
    }

    function handleWpmChange() {
        wpmValueSpan.textContent = wpmSlider.value;
        updateSpeed();
    }

    function handleChapterClick(event) {
        event.preventDefault();
        const target = event.target;
        if (target.tagName === 'A') {
            const chapterTitle = target.textContent;
            const chapter = chapterData.find(c => c.title === chapterTitle);
            if (chapter) {
                scrollToChapter(chapter.startWordIndex);
            }
        }
    }

    function scrollToChapter(startWordIndex) {
        const words = fullBookText.split(/\s+/);
        let cumulativeWordCount = 0;
        for (let i = 0; i < words.length; i++) {
            cumulativeWordCount += words[i].split(/\s+/).filter(w => w.length > 0).length;
            if (cumulativeWordCount >= startWordIndex) {
                const wordElement = document.getElementById(`word-${i}`);
                if (wordElement) {
                    wordElement.scrollIntoView({ behavior: 'smooth' });
                    break;
                }
            }
        }
    }

    function displayChapters(chapters) {
        chapterList.innerHTML = '';
        chapters.forEach(chapter => {
            const li = document.createElement('li');
            li.textContent = chapter.title;
            chapterList.appendChild(li);
        });
        chapterListContainer.style.display = 'block';
    }

    function displayChapters(toc) {
        chapterList.innerHTML = '';
        if (!toc || toc.length === 0) {
            chapterListContainer.style.display = 'none';
            return;
        }

        let hasVisibleChapters = false;
        toc.forEach((item, index) => {
            if (typeof item.startWordIndex === 'number' && item.startWordIndex >= 0) {
                const li = document.createElement('li');
                li.textContent = item.title;
                li.style.paddingLeft = `${item.level * 15}px`;
                li.dataset.index = index;
                li.dataset.wordIndex = item.startWordIndex;
                chapterList.appendChild(li);
                hasVisibleChapters = true;
            } else {
                console.warn(`Skipping chapter '${item.title}' due to invalid startWordIndex (${item.startWordIndex}).`);
            }
        });

        if (hasVisibleChapters) {
            chapterListContainer.style.display = 'block';
        } else {
             chapterListContainer.style.display = 'none';
             logStatus("Chapters found, but could not map them to content positions.");
        }
    }

    function handleChapterClick(event) {
        if (event.target.tagName === 'LI') {
            const wordIndex = parseInt(event.target.dataset.wordIndex, 10);
            const chapterIndex = parseInt(event.target.dataset.index, 10);

            if (!isNaN(wordIndex) && wordIndex >= 0) {
                 logStatus(`Jumping to chapter: ${chapterData[chapterIndex]?.title || 'Unknown'}`);
                jumpToWordIndex(wordIndex);

                 document.querySelectorAll('#chapter-list li.active').forEach(el => el.classList.remove('active'));
                 event.target.classList.add('active');

            } else {
                logStatus(`Could not jump to chapter '${event.target.textContent}', invalid word index.`, true);
            }
        }
    }

     function jumpToWordIndex(index) {
        stopReading();
        if (index >= 0 && index < words.length) {
            currentWordIndex = index;
            flashWord();
        } else {
             console.error(`Attempted to jump to invalid word index: ${index} (total words: ${words.length})`);
             logStatus(`Error jumping to word index ${index}.`, true);
        }
    }

}); 