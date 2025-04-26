# FlashRead: RSVP Ebook Reader

A web application designed to read ebooks (PDF, EPUB) using the Rapid Serial Visual Presentation (RSVP) method. Upload your ebook, and the app will display it one word at a time at your chosen speed, aiming to enhance reading speed and focus.

## Features

-   **File Upload:** Supports PDF and EPUB file formats.
-   **RSVP Display:** Presents text word-by-word for speed reading.
-   **Playback Controls:**
    -   Play/Pause functionality.
    -   Adjustable Words Per Minute (WPM) slider (50-1000 WPM).
-   **Chapter Navigation:** Easily jump between chapters in EPUB files.
-   **(Experimental) OCR for Image-based PDFs:** Uses OpenAI Vision API to extract text from PDFs that contain images instead of selectable text.
-   **(Experimental) Automatic Title Generation:** Generates a title using OpenAI if one cannot be extracted directly from the file metadata.
-   **Security:**
    -   Uses DOMPurify to sanitize potentially unsafe HTML content within EPUBs.
    -   Implements a strict Content Security Policy (CSP).
    -   Utilizes Subresource Integrity (SRI) for all external scripts loaded from CDNs.

## Technologies Used

-   HTML5, CSS3, Vanilla JavaScript
-   [pdf.js](https://mozilla.github.io/pdf.js/): For rendering PDF files.
-   [epub.js](http://epubjs.org/): For rendering EPUB files.
-   [JSZip](https://stuk.github.io/jszip/): A dependency for epub.js.
-   [DOMPurify](https://github.com/cure53/DOMPurify): For HTML sanitization.
-   [OpenAI API (LLM OCR)](https://openai.com/): For optional OCR and title generation features.

## Setup & Usage

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd flash_read
    ```
2.  **(Optional) OpenAI API Key:**
    -   If you want to use the OCR or automatic title generation features for PDFs, you will be prompted for your OpenAI API key at runtime. **Your key is never stored.**
3.  **Run the application:**
    -   Since this is a simple client-side application, you can usually just open the `index.html` file directly in your web browser.
    -   Alternatively, you can serve the directory using a simple local web server (e.g., using Python):
        ```bash
        python -m http.server 8000
        ```
        Then navigate to `http://localhost:8000` in your browser.
4.  **Upload a File:** Use the upload button to select a PDF or EPUB file.
5.  **Read:** Use the controls to play/pause and adjust the reading speed. For EPUBs, use the chapter list to navigate.

## Security Considerations

-   The application includes a Content Security Policy (CSP) to mitigate cross-site scripting (XSS) and data injection attacks.
-   DOMPurify is used to sanitize EPUB content before rendering.
-   SRI hashes are used to ensure the integrity of libraries loaded from CDNs.
-   Be cautious when using your OpenAI API key. For real-world deployment, it's much safer to handle API calls through a backend proxy service that securely stores the key.

## Notes

- The RSVP display and controls are now visually centered for a better reading experience.
- MIT licensed — free for personal or commercial use, modification, and distribution.

## License

This project is licensed under the [MIT License](LICENSE). 