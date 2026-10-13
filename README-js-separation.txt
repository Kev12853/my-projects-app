My Projects — JavaScript separation (local test build)

Files in this package:
- index.html: HTML structure and script references
- styles.css: existing stylesheet
- app.js: existing application JavaScript moved out of index.html without changing its logic
- sw.js: updated service worker cache list/version to include app.js

Installation / test:
1. Back up your current local project folder first.
2. Extract these files into the local project folder, replacing index.html and sw.js and adding app.js. Keep your existing config.js, manifest.json, icons, Supabase SQL setup, and other files.
3. Run the local app and check sign-in, project/task creation and deletion, sync across local/web/Android, and offline startup.
4. Do not publish until all tests pass.

Note: To preserve the currently working behaviour, the sync logic remains inside app.js for this first refactor. It has been moved as-is rather than split into a separate sync.js module, which would require a deeper code refactor and additional testing.
