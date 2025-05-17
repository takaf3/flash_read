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

                // --- OCR Fallback --- >
                // Check if text extraction yielded meaningful content
                const extractedWords = fullBookText.trim().split(/\s+/).filter(w => w.length > 0);
                if (extractedWords.length < 10 && pdf.numPages > 0) { // Heuristic: less than 10 words likely failed extraction
                    logStatus(`Initial text extraction yielded only ${extractedWords.length} words. The PDF might be image-based.`);
                    const doOcr = confirm(`Do you want to try OCR using OpenAI (GPT-4.1-nano)?\n\nWarning:\n- This sends page images to OpenAI.\n- This can be SLOW and COSTLY depending on the PDF length and your OpenAI usage.\n- Ensure you understand OpenAI's pricing and terms.`);

                    if (doOcr) {
                        const apiKey = prompt("Please enter your OpenAI API Key:\n(Key is used client-side only for this session - NOT secure for public apps)");
                        if (apiKey) {
                            logStatus("Starting OCR process with OpenAI... This may take a while.");
                            // Disable upload while OCR is running
                            uploadInput.disabled = true;
                            await performOcrWithOpenAI(pdf, apiKey);
                             uploadInput.disabled = false; // Re-enable upload
                        } else {
                            logStatus("OCR cancelled: No API key provided.");
                        }
                    }
                }
                // < --- End OCR Fallback ---

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

    // --- OpenAI OCR Function (Text Extraction Only) ---
    async function performOcrWithOpenAI(pdfDoc, apiKey) {
        const ocrTextPerPage = []; // Store only text per page
        // const ocrPageData = []; // Removed temporary storage
        const totalPages = pdfDoc.numPages;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let ocrSuccessful = true; // Flag to track if OCR succeeded for all pages

        try {
            for (let i = 1; i <= totalPages; i++) {
                logStatus(`OCR Progress: Rendering page ${i}/${totalPages}...`);
                const page = await pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 });
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = { canvasContext: ctx, viewport: viewport };
                await page.render(renderContext).promise;

                const imageDataUrl = canvas.toDataURL('image/png');

                logStatus(`OCR Progress: Sending page ${i}/${totalPages} for text extraction...`);

                const requestBody = {
                    model: "gpt-4.1-nano", // Or gpt-4o if nano fails image input
                    // response_format removed
                    messages: [
                         {
                            role: "system",
                            content: "You are an OCR assistant. Analyze the image and extract all text. Respond ONLY with the extracted text, nothing else."
                        },{
                            role: "user",
                            content: [
                                // No text prompt needed, system message is clear
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: imageDataUrl,
                                        detail: "low"
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 2000 // Should be sufficient for text-only extraction per page
                };

                try {
                    const response = await fetch("https://api.openai.com/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        console.error('OpenAI API Error:', errorData);
                        throw new Error(`OpenAI API request failed for page ${i}: ${response.statusText} - ${errorData.error?.message}`);
                    }

                    const result = await response.json();
                    // JSON parsing removed - expect plain text
                    const text = result.choices[0]?.message?.content || '';
                    ocrTextPerPage.push(text.trim());
                    logStatus(`OCR Progress: Received text for page ${i}/${totalPages}.`);

                    await new Promise(resolve => setTimeout(resolve, 300)); // Slightly reduced delay maybe ok

                } catch (fetchError) {
                    console.error(`Fetch error during OpenAI call for page ${i}:`, fetchError);
                    // Push empty string and continue, but flag failure
                    ocrTextPerPage.push('');
                    ocrSuccessful = false;
                    logStatus(`OCR Warning: Failed to get text for page ${i}. Continuing...`, true);
                    // No need to throw, allow process to finish
                    // throw new Error(`Network or API error during OCR for page ${i}: ${fetchError.message}`);
                }
            }

            if (!ocrSuccessful) {
                 logStatus("OCR completed, but some pages failed extraction.", true);
            }

            // --- Generate Titles (New Step) --- >
            logStatus("OCR text extraction complete. Generating titles...");
            let generatedTitles = await generateTitlesWithLLM(ocrTextPerPage, apiKey);
            // < --- End Generate Titles ---

            // Calculate start word indices and create chapterData
            chapterData = [];
            let cumulativeWordCount = 0;
            for (let i = 0; i < ocrTextPerPage.length; i++) {
                const pageText = ocrTextPerPage[i];
                const pageWords = pageText.split(/\s+/).filter(w => w.length > 0);
                chapterData.push({
                    // Use generated title, fallback to Page #
                    title: generatedTitles[i] || `Page ${i + 1}`,
                    level: 0,
                    startWordIndex: cumulativeWordCount
                });
                cumulativeWordCount += pageWords.length + (i > 0 ? 2 : 0);
            }

            fullBookText = ocrTextPerPage.join('\n\n');
            logStatus("Chapter titles generated. Ready to read.");

            displayChapters(chapterData);
            setupReader(fullBookText);

        } catch (error) {
            // Catch errors from the main loop or title generation
            console.error('Error during OCR/Title process:', error);
            logStatus(`OCR/Title process failed: ${error.message}`, true);
            readerSection.style.display = 'none';
            chapterListContainer.style.display = 'none';
        }
    }

    // --- Function to Generate Titles Post-OCR ---
    async function generateTitlesWithLLM(pageTexts, apiKey) {
        if (!pageTexts || pageTexts.length === 0) return [];

        // Prepare the input for the LLM - format page text clearly
        let promptContent = "Generate a concise, relevant title (3-7 words) for the main topic of each page text provided below. Respond ONLY with a JSON array of strings, where each string is the title for the corresponding page. Example: [\"Title for Page 1\", \"Title for Page 2\", ...].\n\n";
        pageTexts.forEach((text, index) => {
            // Include only a snippet to avoid excessive token usage, e.g., first 500 chars
            const snippet = text.substring(0, 500);
            promptContent += `--- Page ${index + 1} Text Snippet ---\n${snippet}\n\n`;
        });

        const requestBody = {
             model: "gpt-4.1-nano", // Or another suitable model
             response_format: { type: "json_object" }, // Expecting a JSON object containing the array
             messages: [
                 {
                     role: "system",
                     content: "You are an assistant that generates concise titles for text snippets. Respond ONLY with a JSON object containing a single key 'titles' which holds an array of strings, one title per page provided. The number of titles must match the number of pages."
                 },
                 {
                     role: "user",
                     content: promptContent
                 }
             ],
             max_tokens: 150 * pageTexts.length // Estimate tokens needed (adjust as needed)
         };

         try {
            logStatus(`Sending ${pageTexts.length} page snippets for title generation...`);
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                 method: "POST",
                 headers: {
                     "Content-Type": "application/json",
                     "Authorization": `Bearer ${apiKey}`
                 },
                 body: JSON.stringify(requestBody)
             });

             if (!response.ok) {
                 const errorData = await response.json();
                 console.error('OpenAI API Error (Title Generation):', errorData);
                 throw new Error(`Title generation failed: ${response.statusText} - ${errorData.error?.message}`);
             }

             const result = await response.json();
             const content = JSON.parse(result.choices[0]?.message?.content);

             if (content && Array.isArray(content.titles) && content.titles.length === pageTexts.length) {
                 logStatus("Titles generated successfully.");
                 return content.titles;
             } else {
                 console.warn("Title generation response format incorrect or title count mismatch.", content);
                 throw new Error("Failed to parse titles correctly from response.");
             }

         } catch (error) {
             console.error("Error during title generation:", error);
             logStatus(`Title generation failed: ${error.message}. Using default page numbers.`, true);
             return []; // Return empty array on failure
         }
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
                // renderTo still puts content into hidden div; ensure the container is inert
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
                    // Sanitize with DOMPurify to strip any inline scripts/styles
                    const cleanHtml = DOMPurify.sanitize(contents, {SAFE_FOR_JQUERY: true});
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = cleanHtml;
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