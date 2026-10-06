# Living Study Guide

A private study guide built from your own notes, for the Handshake mission
"Create a Study App: Build a Living Study Guide".

AI drafts flashcards and study items from your notes. Every draft waits in a
**review queue** next to the sentence it came from, and nothing reaches your
library until you approve, edit, merge or discard it.

## What it does

| Mission requirement | Where it lives |
|---|---|
| Read your notes, identify key concepts, write flashcards and quiz questions | **Add notes**: paste text, upload `.txt`/`.md`, or upload a `.vtt`/`.srt` lecture transcript |
| Every new card sits beside the source sentence until you approve, edit or discard it | **Review queue**: your notes on the left (exact quote highlighted in context), the editable draft on the right |
| Catch confident additions ("Rome fell in 476 AD *because of barbarian invasions*") | Every field flags words that are not in your notes nearby, while you type |
| Keep source facts apart from generated interpretation | "What your notes say" vs a separate, labelled **AI interpretation — not from your notes** box |
| Approve, edit, merge, tag, discard | Queue actions (keys `A` `D` `M` `S`), undo on approve/discard, "compare with the original draft" |
| Cards the drafting missed | **Sources**: select any passage in your notes, then **+ Make a card**. The card is checked against that passage and saved as "Written by you" |
| Searchable library you can quiz yourself from | **Library** (search across titles, answers, excerpts, tags), **Flashcards** (Leitner boxes), **Quick quiz** (wrong options are other approved items, never invented), **Study session** (focus mode + timer) |
| Source-linked summaries, concept pages, how-to guides | **Guides & summaries** (every line cites its source sentence), item pages, **Sources** view with every used sentence highlighted |
| Understanding dashboard | **Understanding**: mastery, due cards, accuracy, weak spots, open questions, and how the review queue went |
| Make it yours | **Settings → Make it yours**: subject + focus (concept recall, exam review, how-to, meeting prep), used when drafting |
| Saves progress between sessions | SQLite database in `data/study.sqlite` |
| Private behind a login | One owner account, created on first visit; every page and API call requires it |
| Download a full backup | **Settings → Download full backup (.json)**, restore from it, or export the library as Markdown |

Demo notes ("How Memory Works") are included so the whole flow can be tried before you use your own material.

## Run it with XAMPP

1. Start **Apache** in the XAMPP Control Panel.
2. Open <http://localhost/path/study-app/>.
3. Create your owner account (first visit only). Then **Add notes**, or **Load demo notes**.

Requirements: PHP 8.2+ with `pdo_sqlite` and `curl` (XAMPP has both) and the Composer packages in `vendor/`
(already installed; reinstall with `composer install`).

Without XAMPP, PHP's built-in server works too. Only the `public/` folder is served:

```bash
php -S localhost:8080 -t public
```

## Turn on Claude

Without an API key the app uses its **offline extractor**. It never writes new prose: it turns definitions,
dated facts, numbered steps and questions in your own sentences into cards. To have Claude draft the items:

1. Copy `.env.example` to `.env`.
2. Set `ANTHROPIC_API_KEY=...` (from <https://console.anthropic.com/>).
3. Reload the app. **Add notes** now offers "Claude".

Claude (`claude-opus-5-5`, effort `medium`) returns structured JSON. Every draft must quote its excerpt
character for character. The app then looks for that quote in your notes and marks it as one of:

- **Exact quote**: found word for word.
- **Closest sentence**: not verbatim, so the nearest real sentence is shown instead.
- **Not found**: no match in your notes.

Server-side refusal fallbacks (`fallbacks: "default"`) are enabled, so a request a safety classifier declines is
retried on Anthropic's recommended fallback model instead of failing. Optional settings (`STUDY_MODEL`,
`STUDY_EFFORT`, `CA_BUNDLE`, `STUDY_DATA_DIR`) are described in `.env.example`.

## Publish it (mission phase IV)

The mission publishes on Replit. To do that with this app:

1. Import the folder into a Replit project and set `ANTHROPIC_API_KEY` under **Secrets**.
2. Use `php -S 0.0.0.0:8000 -t public` as the run command and publish.
3. Run the three checks from the brief:
   - Reopen the URL and confirm your library is still there.
   - Open it in a private window and confirm you only get the sign-in page.
   - Download a backup from **Settings**.

Replit Autoscale deployments do not keep files between deploys, so the SQLite database can be reset. Prefer a
Reserved VM deployment, and download a backup regularly either way.

## Security notes

- Only `public/` is web-facing. Code (`src/`), the database (`data/`), `vendor/`, `demo/` and `.env` sit outside
  it; under Apache the root `.htaccess` rewrites everything into `public/` and denies the rest.
- Passwords are hashed with `password_hash`. Five failed sign-ins lock that address out for 15 minutes.
  Sessions are HttpOnly, SameSite=Lax cookies, and every write needs a CSRF token.
- Pages ship a strict Content-Security-Policy, and notes are always rendered as text, never as HTML.
- Backups contain everything except the login.

### Notes for this machine (Norton Antivirus)

- Norton re-signs HTTPS traffic with its own root certificate, which PHP's bundled `cacert.pem` does not
  contain. The app's HTTP client (`src/CurlHttpClient.php`) therefore also trusts the Windows certificate store.
  This needs no configuration; set `CA_BUNDLE` only if you want a specific CA file.
- While this app was being built, something on this machine (most likely Norton's real-time protection)
  silently removed a small PHP "router" script twice. That script returned "Not found" for private folders,
  which resembles malware cloaking. The app is laid out with a `public/` folder precisely so that no such
  script is needed. If Norton shows a quarantine entry for `router.php` or `dev-router.php` from this folder,
  it was that false positive. The folder may also refuse the name `router.php` until Windows releases it
  (after a restart at the latest).

## Project layout

```
public/            web root: index.php (app shell), login.php, logout.php, api.php, assets/
src/               PHP: Db, Auth, Sources, Items, Study, Dashboard, Backup,
                   ClaudeExtractor, LocalExtractor, Text (excerpt matching), CurlHttpClient
data/              study.sqlite (created on first run)
demo/              demo notes
tests/             unit.php, smoke.test.mjs (end-to-end), ui.test.mjs (browser-side checks)
.github/workflows/ ci.yml and cd.yml
Dockerfile         container image used by CD
```

## Tests

```bash
composer test
```

This runs `tests/unit.php` (excerpt matching, chunking, the offline extractor), then `tests/smoke.test.mjs`
with Node. The smoke test starts the app on a free port with a throwaway database and uses it like a browser:
first-run sign-up, demo notes, the review queue, study modes, making your own card, backup and restore,
signing out, and the sign-in lockout. It never calls the Claude API. The browser-side checks (the
"words not in your notes" logic) run with:

```bash
node --test tests/ui.test.mjs
```

The smoke test is JavaScript rather than PHP on purpose: Norton removed a PHP version of it from this
machine, because a PHP file under a web folder that starts processes and opens connections looks like a web
shell.

## CI/CD (GitHub Actions)

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to a branch other than `main`:
  - PHP 8.2, 8.3 and 8.4: `composer validate`, a lint of every PHP file, the unit tests and the end-to-end
    smoke test.
  - JavaScript: a syntax check of every browser module, plus the Node unit tests.
  - Docker: builds the image, starts a container and checks that it serves the sign-in page.
- **CD** (`.github/workflows/cd.yml`) runs on every push to `main` and on version tags. It runs the full CI
  first, then delivers:
  - Each push to `main` publishes the container image to GitHub Container Registry as
    `ghcr.io/mahfuzt786/living-study-guide`, tagged `latest` and `sha-<commit>`.
  - A tag such as `v1.0.0` also publishes the image as `1.0.0` and creates a GitHub release with
    `living-study-guide-v1.0.0.zip`. That zip contains the code plus production dependencies, ready to unzip
    into XAMPP or shared hosting.

  Both use the workflow's built-in `GITHUB_TOKEN`, so no secrets need to be configured.

To cut a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

To run the published image on any Docker host:

```bash
docker run -d -p 8080:8080 -v study-data:/app/data -e ANTHROPIC_API_KEY=your-key ghcr.io/mahfuzt786/living-study-guide:latest
```

Mount `/app/data` on a volume, or the database is lost when the container is replaced.

The image's visibility is set separately from the repository's. GitHub published the first image as **public**
even though this repository is private, so it was switched to private under the package's **Package settings →
Danger Zone**, and later pushes keep that setting. To pull it, first run `docker login ghcr.io` with a personal
access token that has the `read:packages` scope. If you ever recreate the package, check its visibility again.

## Submitting to Handshake

Share the published link or a screenshot. The **Understanding** page's "How the review queue went" section
gives the numbers for your write-up: how many drafts you approved as written, corrected, merged or
discarded, and how many excerpts matched your notes word for word. Describe what *you* noticed when
comparing the generated cards with your notes; the "Compare with the original draft" view on each item shows
exactly what you changed.
