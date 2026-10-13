MY PROJECTS — SUPABASE TEST VERSION

IMPORTANT: This is a separate test version. It does not change your live GitHub Pages website.

SETUP
1. Open config.js in a plain-text editor (Notepad is fine).
2. Replace PASTE_YOUR_SUPABASE_PROJECT_URL_HERE with your Supabase Project URL.
3. Replace PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE with your sb_publishable_... key.
4. Keep the single quotes around each value. Save the file.
5. For browser-based Supabase Auth, run this app from a local web server or GitHub Pages; opening index.html directly as file:// may block requests.
6. Open the app. Create an account with your email and a password, then sign in. If email confirmation is enabled in Supabase, confirm your email first.

FEATURES
- Projects and their tasks are stored in Supabase.
- Standalone tasks are stored in the same tasks table with no project_id.
- Select tasks for today's list with the “Do today” button.
- Completing a task on today's list updates its original task record.
- Projects and tasks sync to the signed-in account.
- On the first sign-in, if the cloud database is empty, this browser's existing local projects/tasks are uploaded.

SECURITY
- Only use the Supabase Project URL and publishable key in config.js.
- NEVER use a secret key or service_role key in a browser app.
- Keep Row Level Security enabled on both tables.

NOTE
This is an initial integration for testing. Keep a backup of your existing app and check the app carefully before publishing it to GitHub Pages.
