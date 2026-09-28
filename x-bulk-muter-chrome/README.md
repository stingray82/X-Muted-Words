# X Bulk Muter

A small Chrome extension for bulk-adding muted words and phrases on **X (formerly Twitter)** using X's normal **Muted words** settings screen.

It is designed for people who maintain a large mute list and do not want to add every entry manually one at a time.


## Demo

![X Bulk Muter demo](https://github.com/stingray82/repo-images/raw/main/x-bulk-muter/X-bulk-muter.gif)

---

## Important compatibility warning

> **X can change its interface, routes, page markup, or rate-limit behaviour at any time.**
>
> This extension automates X's normal settings UI, so a change made by X can temporarily break selectors, navigation, scanning, saving, or rate-limit detection. If that happens, the extension may need an update before it works reliably again.
>
> For unattended runs, start with the **20-second pace**. X controls its own throttling and HTTP `429` behaviour, so no delay or backoff strategy can guarantee uninterrupted operation.

---

> **Current tested build:** v1.7

---

## Features

- Bulk-adds muted words and phrases to X
- Scans the existing muted-word list before adding
- Skips words and phrases that are already muted
- Can bulk-unmute matching words from the supplied list
- Uses X's existing **Add muted word** form rather than modifying account data directly
- Leaves your existing mute options unchanged:
  - Home timeline
  - Notifications
  - Notification audience
  - Mute duration
- Supports one word or phrase per line
- Includes a built-in starter word list
- Can load a maintained word list from a raw GitHub `.txt` or `.md` file
- Automatically resumes from saved progress
- Detects failed/rate-limited saves and backs off
- Adaptive rate-limit cooldown:
  - first detected rate limit → 1 minute
  - next consecutive rate limit → 2 minutes
  - then 3, 4, 5 minutes, etc.
  - maximum cooldown → 20 minutes
- Retries the same item after a cooldown
- Resets the cooldown level after a successful save
- Includes a manual **Stop** button
- Includes a **Reset saved progress** button

---

## How it works

Before adding anything, the extension scans X's current muted-word list and removes existing matches from the pending queue. It then follows the normal X interface flow for anything still missing:

```text
/settings/muted_keywords
        ↓
Click "Add muted word or phrase"
        ↓
/settings/add_muted_keyword
        ↓
Fill input[name="keyword"]
        ↓
Click Save
        ↓
Return to /settings/muted_keywords
        ↓
Repeat
```

The extension deliberately avoids relying on X's generated CSS class names wherever possible.

Instead, it targets more stable attributes such as:

```text
a[href="/settings/add_muted_keyword"]
input[name="keyword"]
button[data-testid="settingsDetailSave"]
button[aria-label="Unmute"]
```

This should make it somewhat more resilient to cosmetic X interface changes.

---

## Installation

This project currently uses a **Chrome Manifest V3** unpacked extension.

### 1. Download or clone the repository

Clone it:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
```

Or download the repository as a ZIP and extract it.

### 2. Open Chrome Extensions

Navigate to:

```text
chrome://extensions
```

### 3. Enable Developer mode

Turn on **Developer mode** in the top-right corner.

### 4. Load the extension

Click:

```text
Load unpacked
```

Select the folder containing:

```text
manifest.json
```

### 5. Reload X

If X was already open, reload the tab once after installing or updating the extension.

---

## Usage

Open X and navigate to:

```text
Settings and privacy
→ Privacy and safety
→ Mute and block
→ Muted words
```

You can also go directly to:

```text
https://x.com/settings/muted_keywords
```

Then:

1. Click the **X Bulk Muter** extension icon.
2. Load the built-in list, paste your own list, or load a list from GitHub.
3. Choose a pace.
4. Click **Start / resume**.
5. Leave the X tab open while the extension works through the queue.

---

## Word-list format

Use **one word or phrase per line**.

Example:

```text
example word
example phrase
#examplehashtag
another phrase
```

Blank lines are ignored.

Duplicate entries are removed before processing.

Basic Markdown list formatting is also accepted:

```md
- example word
- example phrase
- #examplehashtag
```

The extension strips simple bullet markers when loading the list.

---

## Maintaining the word list on GitHub

You can keep your list in the same repository or in a separate repository.

For example:

```text
words.txt
```

or:

```text
words.md
```

Open the file on GitHub and click **Raw**.

You should end up with a URL similar to:

```text
https://raw.githubusercontent.com/YOUR-USERNAME/YOUR-REPO/main/words.txt
```

Paste that URL into the extension's:

```text
Optional raw GitHub list URL
```

field and click:

```text
Load repo
```

This makes it easy to maintain one canonical list without rebuilding the extension every time you add or remove terms.

---

## Recommended pace

X may rate-limit repeated settings changes.

The extension currently offers several pacing options.

For larger lists, the recommended starting point is:

```text
15 seconds
```

If X begins returning rate-limit errors, use:

```text
20 seconds
```

A faster setting may work for short lists but is more likely to trigger throttling.

---

## Rate limiting / HTTP 429

X may respond with:

```text
429 Too Many Requests
```

when too many muted-word saves are performed in a short period.

The extension uses adaptive backoff.

For consecutive detected rate limits:

```text
1st  → wait 1 minute
2nd  → wait 2 minutes
3rd  → wait 3 minutes
...
20th → wait 20 minutes
```

The wait is capped at **20 minutes**.

After the cooldown, the extension retries the **same word** rather than skipping it.

After a successful save, the rate-limit backoff resets to zero.

The following state is saved locally in Chrome:

- current queue position
- current backoff level
- active cooldown time

This allows the extension to recover more cleanly after a page refresh.

> X controls its own rate limits. No cooldown strategy can guarantee that a specific wait duration will always be sufficient.

---

## Updating the extension

After pulling a new version from GitHub:

1. Open:

   ```text
   chrome://extensions
   ```

2. Find **X Bulk Muter**.
3. Click the extension's **Reload** button.

If files or the manifest structure changed significantly, remove the unpacked extension and use **Load unpacked** again.

Then reload the X tab.

---

## Troubleshooting

### The extension keeps returning to the Muted words page

Make sure you are using **v1.4 or later**.

Older builds had a navigation issue where:

```text
/settings/add_muted_keyword
```

could incorrectly be treated as the wrong page.

---

### Nothing happens when I click Start

Reload the X tab once after installing or updating the extension.

Then make sure you are on:

```text
https://x.com/settings/muted_keywords
```

---

### X stops accepting new muted words

Open Chrome DevTools and check the Console / Network tab.

If you see:

```text
429
```

X has rate-limited the account/session.

The extension should automatically enter its cooldown cycle.

---

### The Save button is not found

X may have changed its interface.

The current build looks for:

```text
button[data-testid="settingsDetailSave"]
```

If X changes that attribute, `content.js` will need to be updated.

---

### The Add button is not found

The current selector is:

```text
a[href="/settings/add_muted_keyword"]
```

If X changes its settings routes, update this selector in `content.js`.

---

### The word field is not found

The current selector is:

```text
input[name="keyword"]
```

Again, this may need updating if X changes the page markup.

---

## Project structure

A typical checkout looks like this:

```text
x-bulk-muter/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.css
├── popup.js
├── words.txt
└── README.md
```

### `manifest.json`

Chrome Manifest V3 configuration.

### `content.js`

Runs on X and performs the page automation.

### `background.js`

Handles tasks such as fetching a remote raw GitHub word list.

### `popup.html`

Extension popup interface.

### `popup.js`

Popup controls, saved settings, list parsing, and communication with the X tab.

### `popup.css`

Popup styling.

### `words.txt`

Built-in fallback word list.

---

## Permissions

The extension currently requests access to:

```text
https://x.com/*
https://twitter.com/*
https://raw.githubusercontent.com/*
```

It also uses Chrome's:

```text
storage
tabs
```

permissions.

### Why?

**X / Twitter access**

Required to interact with the muted-word settings page.

**raw.githubusercontent.com**

Required only for loading an optional remote word list.

**storage**

Used to save:

- the current list
- queue progress
- selected delay
- rate-limit cooldown state
- remote list URL

**tabs**

Used to communicate with the currently active X tab.

---

## Privacy

X Bulk Muter does not require its own server.

The extension operates locally in Chrome.

The extension does **not** need your X password and should never ask for it.

When using the GitHub list feature, the extension downloads only the raw list URL you provide.

Check the source before installing any browser extension, including this one.

---

## Development

After editing extension files:

1. Open:

   ```text
   chrome://extensions
   ```

2. Click **Reload** on X Bulk Muter.
3. Reload the X tab.
4. Test again.

For debugging the automation:

1. Open the X tab.
2. Press **F12**.
3. Open **Console**.

The content script logs messages prefixed with:

```text
[X Bulk Muter]
```

---

## Known limitations

- X can change its HTML, routes, or internal behavior at any time.
- X may introduce new anti-automation or rate-limit behavior.
- A muted word can also hide legitimate posts containing the same word.
- Muted words do not guarantee that every unwanted image or video is removed.
- X may impose undocumented limits on the number or frequency of muted-word changes.
- Long unattended runs require the browser, extension, X session, and tab to remain active.

---

## Safety when building lists

Very broad terms can create a large number of false positives.

For example, generic words may appear in:

- news
- medical discussions
- jokes
- usernames
- unrelated phrases

Start with specific phrases and expand your list based on what actually appears in your feed.

---

## Disclaimer

This project is an independent utility and is **not affiliated with, endorsed by, or sponsored by X Corp.**

"X", "Twitter", and related names are trademarks of their respective owners.

This project automates actions available through the normal X settings interface. Use it responsibly and at your own risk.

X may change its site, page markup, routes, rate limits, or policies at any time, which can break the extension without warning. This project is maintained on a best-effort basis and may require selector or flow updates when X changes its interface.

---

## Contributing

Bug reports and pull requests are welcome.

Useful contributions include:

- selector fixes after X UI changes
- improved rate-limit detection
- better queue recovery
- UI improvements
- better list parsing
- additional browser support
- documentation improvements

When reporting a bug, include:

- extension version
- Chrome version
- the X settings URL where the problem occurred
- relevant Console errors
- whether a `429` response appeared

Please avoid including private account information in issue reports.

---

## License

Choose a license before publishing the repository.

For a simple open-source browser utility, the **MIT License** is a common option.

If using MIT, add a `LICENSE` file to the repository before release.
