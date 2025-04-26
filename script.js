document.addEventListener('DOMContentLoaded', () => {
    const uploadInput = document.getElementById('ebook-upload');
    const readerSection = document.getElementById('reader-section');
    const flashWordDiv = document.getElementById('flash-word');
    const playPauseButton = document.getElementById('play-pause');
    const wpmInput = document.getElementById('wpm');

    let words = [];
    let currentWordIndex = 0;
    let isPlaying = false;
    let intervalId = null;

    uploadInput.addEventListener('change', handleFileUpload);
    playPauseButton.addEventListener('click', togglePlayPause);
    wpmInput.addEventListener('change', updateSpeed);

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        console.log(`File selected: ${file.name}, type: ${file.type}`);

        // Reset UI elements before parsing
        readerSection.style.display = 'none'; // Hide reader until text is ready
        resetReader(); // Clear previous state
        flashWordDiv.textContent = 'Loading...'; // Indicate loading

        if (file.type === 'application/pdf') {
            parsePdf(file);
        } else if (file.type === 'application/epub+zip') {
            parseEpub(file);
        } else {
            alert('Unsupported file type. Please upload PDF or EPUB.');
            flashWordDiv.textContent = ''; // Clear loading message
        }
    }

    async function parsePdf(file) {
        const reader = new FileReader();

        reader.onload = async (e) => {
            const typedArray = new Uint8Array(e.target.result);
            try {
                const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                console.log(`PDF loaded: ${pdf.numPages} pages`);
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    // Join text items, handling potential line breaks within words if necessary
                    // Simple join for now:
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n'; // Add newline between pages
                }

                console.log("PDF text extracted.");
                setupReader(fullText);
                readerSection.style.display = 'block'; // Show reader section now

            } catch (error) {
                console.error('Error parsing PDF:', error);
                alert(`Error parsing PDF: ${error.message}`);
                flashWordDiv.textContent = 'Error loading PDF.';
            }
        };

        reader.onerror = (e) => {
            console.error('FileReader error:', e);
            alert('Error reading file.');
             flashWordDiv.textContent = 'Error reading file.';
        }

        reader.readAsArrayBuffer(file);
    }

    async function parseEpub(file) {
        const reader = new FileReader();

        reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            try {
                const book = ePub(arrayBuffer);
                console.log("EPUB loaded.");
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
                await book.locations.generate(1000); // Generate locations for better processing (adjust chars per item if needed)

                console.log("EPUB rendering complete (hidden).");

                let fullText = '';
                // Iterate through the spine (content sections) of the book
                for (const section of book.spine.items) {
                    await section.load(book.load.bind(book)); // Load the section content
                    // Extract text from the loaded section's document body
                    const sectionBody = section.document.body;
                    if (sectionBody) {
                        // Getting textContent is a simple way, might need refinement for complex structures
                        fullText += sectionBody.textContent.trim() + '\n\n'; // Add space between sections
                    }
                    section.unload(); // Unload to free memory
                }

                 console.log("EPUB text extracted.");
                 if (!fullText) {
                    console.warn("Could not extract text from EPUB. It might be image-based or have unusual formatting.");
                    alert("Could not extract text from this EPUB.");
                 }
                setupReader(fullText);
                readerSection.style.display = 'block'; // Show reader section now
                hiddenDiv.remove(); // Clean up the hidden div

            } catch (error) {
                console.error('Error parsing EPUB:', error);
                alert(`Error parsing EPUB: ${error.message}`);
                flashWordDiv.textContent = 'Error loading EPUB.';
                 let hiddenDiv = document.getElementById('epub-render-area');
                 if (hiddenDiv) hiddenDiv.remove(); // Clean up if error occurred
            }
        };

        reader.onerror = (e) => {
            console.error('FileReader error:', e);
            alert('Error reading file.');
            flashWordDiv.textContent = 'Error reading file.';
        }

        reader.readAsArrayBuffer(file);
    }

    function setupReader(text) {
        words = text.split(/\s+/).filter(word => word.length > 0);
        currentWordIndex = 0;
        flashWordDiv.textContent = words.length > 0 ? words[0] : '';
        console.log(`Loaded ${words.length} words.`);
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

        const wpm = parseInt(wpmInput.value, 10);
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
            // If playing, stop and restart with the new speed
            stopReading();
            startReading();
        }
         console.log(`Speed updated to ${wpmInput.value} WPM`);
    }

}); 