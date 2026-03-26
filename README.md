# Netoi Index V2

Static GitHub Pages site for `www.netoi7.me`.

## Editing the library

- Add or edit chapters, collections, and resources in `data/resources.js`
- Resource rows support `labels`, `bestStartingLink`, `related`, `sortRank`, and `status`
- The archive, command palette, local pins, and recent items are rendered by `app.js`
- Styling lives in `styles.css`

## Structure

- `index.html`: poster hero, command palette shell, chapter bar, archive, and signal panels
- `data/resources.js`: categories, collections, and resource data
- `app.js`: weighted search, command palette, local state, filters, and archive rendering
- `styles.css`: editorial utility visual system

## Shortcuts

- `/` or `Ctrl+K`: open command palette
- `Enter`: jump to selected palette result
- `Shift+Enter`: open the selected result’s best starting link when available
