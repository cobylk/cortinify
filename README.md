# Cortinify

`Cortinify` is a Spicetify extension for tango DJs. It gives Spotify a persistent floating control panel with a one-click cortina fade, a turntable-style now-playing display, and a few DJ-friendly live controls.

## Current Features

- Persistent floating panel opened from a playbar button
- One-click cortina fade-out, skip, and volume restore
- Preset fade durations
- Fade progress line with end pulse
- Turntable-inspired now-playing display with rotating album art
- Tonearm animation tied to play/pause
- Current track title, artist, and status pill

## Install

If `Cortinify` is published in Spicetify Marketplace, install it there.

For manual install on macOS:

1. Build the extension:

   ```bash
   npm install
   npm run build
   ```

2. Copy the built file into Spicetify:

   ```bash
   cp dist/cortinify.js ~/.config/spicetify/Extensions/
   ```

3. Enable it and apply:

   ```bash
   spicetify config extensions cortinify.js
   spicetify apply
   ```

4. Restart Spotify if needed.

## Development

- `npm run build`
- `npm run watch`

The built Marketplace/manual-install artifact is `dist/cortinify.js`.

If you distribute this via GitHub or Marketplace, commit the built `dist/cortinify.js` file so users can install it without building locally.
