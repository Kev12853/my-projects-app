My Projects app — local session recovery test

This test keeps the automatic refresh and serialized sync/deletion changes, but restores Supabase's default auth-session storage handling and increments the service-worker cache version so the browser does not keep using the previous cached app shell.

IMPORTANT:
1. Keep a copy of your current app folder. Do not delete it.
2. Extract this ZIP into a NEW folder.
3. Copy your working config.js from your previous local app folder into this new folder, replacing the placeholder config.js. Do not share your key publicly.
4. Run the local server from this new folder and test cloud sync before relying on it.
5. Do not upload/publish this test build until it has been verified.

The app may open using local data if cloud authentication is unavailable. Check that the sync status says "Synced just now" after adding a test task and confirm that task appears in Supabase.
