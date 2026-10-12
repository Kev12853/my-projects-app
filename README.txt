MY PROJECTS — FIRST VERSION

Included
- Create, rename and delete projects
- Add tasks, tick them off and delete them
- Automatic completion progress
- Optional project notes
- Local browser storage; no account or server-side database
- Basic PWA manifest, icons and offline app-shell service worker

IMPORTANT ABOUT INSTALLING ON IPHONE
For a reliable Home Screen installation and offline support, the files need to be served from an HTTPS website. Opening index.html directly from a file or sending it to the iPhone will not provide a full installable PWA.

Quick local preview on a computer:
1. Extract this folder.
2. Open a terminal in the folder.
3. Run: python -m http.server 8000
4. On the same computer, open http://localhost:8000

The local preview is for testing only. For installation on the iPhone, publish these files to an HTTPS static host, then open that HTTPS address in Safari on the iPhone and choose Share > Add to Home Screen.

DATA NOTE
Projects are stored in the browser's localStorage on that device. Clearing Safari website data, using a different browser, or removing site data may remove the projects. This first version does not sync or back up data to another device.

DEVELOPMENT NOTE
This is a deliberately small first version using plain HTML, CSS and JavaScript, with no framework or build step. The service worker is included for offline app-shell caching. Registering it should be enabled after deployment over HTTPS or localhost.
