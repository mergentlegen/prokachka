# Local web fonts

The project bundles the webfont subsets used by the interface:

- DM Sans — weights 400–700
- Manrope — weights 600–800

Both fonts are distributed under the SIL Open Font License 1.1 and were downloaded from Google Fonts. They are loaded from `app/globals.css` via local `/fonts/*.woff2` URLs, so production does not depend on the Google Fonts stylesheet.
