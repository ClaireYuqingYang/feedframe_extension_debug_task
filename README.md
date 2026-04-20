# FeedFrame Chrome Extension Debug Task

This folder contains a small v1-style test package for evaluating Chrome extension web development work. The task is focused on the browser extension and lightweight backend data collection behavior. It does not include model-side files.

## Contents

- `extension/`: Chrome extension files to load with Chrome's "Load unpacked" flow.
- `backend/`: Local Express backend used by the extension for interaction logging.
- `test-data/`: Optional sample payloads or exported interaction records.
- `ISSUE_BRIEF.md`: The two debugging tasks and expected deliverables.

## Running The Extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer Mode.
3. Click "Load unpacked".
4. Select the `extension/` folder.
5. Open `https://bsky.app/` and reproduce the UI behavior.

## Running The Backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

The extension currently points to `http://localhost:3000/api` in `extension/config.js`.

## Notes For Participants

- Focus on the Chrome extension and the interaction data flow.
- Do not work on model training, notebooks, or ML inference.
- Bluesky is a third-party SPA, so fixes should be robust to layout changes and DOM updates.
- If you change the data model, briefly explain whether you are storing click events, latest user state, or both.
