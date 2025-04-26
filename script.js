document.addEventListener('DOMContentLoaded', () => {
    const uploadInput = document.getElementById('ebook-upload');
    const readerSection = document.getElementById('reader-section');
    const flashWordDiv = document.getElementById('flash-word');
    const playPauseButton = document.getElementById('play-pause');
    const wpmSlider = document.getElementById('wpm-slider');
    const wpmValueSpan = document.getElementById('wpm-value');
    const statusArea = document.getElementById('status-area');

    let words = [];
    let currentWordIndex = 0;
    let isPlaying = false;
    let intervalId = null;

    uploadInput.addEventListener('change', handleFileUpload);
    playPauseButton.addEventListener('click', togglePlayPause);
    wpmSlider.addEventListener('input', handleWpmChange);

    // --- Helper function for logging to UI ---
    function logStatus(message, isError = false) {
        console.log(`Status: ${message}` + (isError ? ' (Error)' : ''));
        statusArea.textContent = message;
        statusArea.style.color = isError ? 'red' : '#333';
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        logStatus(`File selected: ${file.name} (${file.type})`);

        // Reset UI elements before parsing
        readerSection.style.display = 'none'; // Hide reader until text is ready
        resetReader(); // Clear previous state

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
            try {
                const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                logStatus(`PDF loaded: ${pdf.numPages} pages. Extracting text...`);
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    // Join text items, handling potential line breaks within words if necessary
                    // Simple join for now:
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n'; // Add newline between pages
                }

                logStatus("PDF text extracted successfully.");
                setupReader(fullText);
                readerSection.style.display = 'block'; // Show reader section now

            } catch (error) {
                console.error('Error parsing PDF:', error);
                logStatus(`Error parsing PDF: ${error.message}`, true);
            }
        };

        reader.onerror = (e) => {
            console.error('FileReader error:', e);
            logStatus('Error reading file.', true);
        }

        reader.readAsArrayBuffer(file);
    }

    async function parseEpub(file) {
        const reader = new FileReader();

        reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            try {
                const book = ePub(arrayBuffer);
                logStatus("EPUB loaded. Rendering (hidden) to extract text...");
                // epub.js needs to render the book to extract text accurately.
                // We'll create a hidden div for rendering.
                let hiddenDiv = document.getElementById('epub-render-area');
                if (!hiddenDiv) {
                    hiddenDiv = document.createElement('div');
                    hiddenDiv.id = 'epub-render-area';
                    hiddenDiv.style.display = 'none'; // Keep it hidden
                    document.body.appendChild(hiddenDiv);
                }

                const rendition = book.renderTo(hiddenDiv.id, { width: 600, height: 400 }); // Dimensions don't matter much as it's hidden
                await book.ready; // Wait for the book metadata
                await rendition.display(); // Necessary to process content
                // Generate locations based on approx 1000 chars per chunk, helps process content
                // Increase number for potentially faster processing but less granularity
                const locations = await book.locations.generate(1000);

                logStatus("EPUB rendered. Extracting text from sections...");

                let fullText = '';
                const allSections = book.spine.items;

                // Sequentially load and process each section's content
                for (const section of allSections) {
                    // Get the content of the section (might return HTML)
                    const contents = await book.load(section.href);
                    // Create a temporary div to parse the HTML content
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = contents;
                    // Extract text content, trim whitespace
                    const sectionText = tempDiv.textContent || tempDiv.innerText || '';
                    fullText += sectionText.trim() + '\n\n';
                }

                 logStatus("EPUB text extracted successfully.");
                 if (!fullText) {
                    console.warn("Could not extract text from EPUB. It might be image-based or have unusual formatting.");
                    logStatus("Warning: Could not extract text from this EPUB.", true);
                 }
                setupReader(fullText);
                readerSection.style.display = 'block'; // Show reader section now
                hiddenDiv.remove(); // Clean up the hidden div

            } catch (error) {
                console.error('Error parsing EPUB:', error);
                logStatus(`Error parsing EPUB: ${error.message}`, true);
            }
        };

        reader.onerror = (e) => {
            console.error('FileReader error:', e);
            logStatus('Error reading file.', true);
        }

        reader.readAsArrayBuffer(file);
    }

    function setupReader(text) {
        words = text.split(/\s+/).filter(word => word.length > 0);
        currentWordIndex = 0;
        flashWordDiv.textContent = words.length > 0 ? words[0] : '';
        logStatus(`Ready to read: ${words.length} words loaded.`);
    }

    function resetReader() {
        stopReading();
        currentWordIndex = 0;
        flashWordDiv.textContent = words.length > 0 ? words[0] : '';
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
        if (words.length === 0 || currentWordIndex >= words.length) return;
        isPlaying = true;
        playPauseButton.textContent = 'Pause';
        flashWord(); // Show the first word immediately if starting from beginning
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
        if (!isPlaying || currentWordIndex >= words.length - 1) {
            stopReading();
            if (currentWordIndex >= words.length -1) {
                 console.log('Finished reading.');
            }
            return;
        }

        const wpm = parseInt(wpmSlider.value, 10);
        const delay = 60000 / wpm; // milliseconds per word

        intervalId = setTimeout(() => {
            currentWordIndex++;
            flashWord();
            scheduleNextWord();
        }, delay);
    }

    function flashWord() {
         if (currentWordIndex < words.length) {
            flashWordDiv.textContent = words[currentWordIndex];
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

}); 