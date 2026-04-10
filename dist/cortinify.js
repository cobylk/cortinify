"use strict";
(() => {
  // src/index.ts
  var APP_NAME = "Cortinify";
  var DEFAULT_FADE_SECONDS = 6;
  var NEXT_TRACK_DELAY_MS = 150;
  var FADE_SECONDS_KEY = "cortinify:fade-seconds";
  var PANEL_VISIBLE_KEY = "cortinify:panel-visible";
  var PANEL_COLLAPSED_KEY = "cortinify:panel-collapsed";
  var CORTINA_TAGS_KEY = "cortinify:cortina-tags";
  var PLAYBAR_ICON = "skip-forward";
  var PANEL_ID = "cortinify-panel";
  var initialized = false;
  var isFading = false;
  var playbarButton = null;
  var panelManager = null;
  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function getStoredBoolean(key, fallback) {
    const value = Spicetify.LocalStorage?.get(key);
    if (value === null || value === void 0) {
      return fallback;
    }
    return value === "true";
  }
  function saveStoredBoolean(key, value) {
    Spicetify.LocalStorage?.set(key, String(value));
  }
  function getSavedFadeSeconds() {
    const rawValue = Spicetify.LocalStorage?.get(FADE_SECONDS_KEY);
    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) ? clamp(parsedValue, 0, 60) : DEFAULT_FADE_SECONDS;
  }
  function saveFadeSeconds(value) {
    Spicetify.LocalStorage?.set(FADE_SECONDS_KEY, String(clamp(value, 0, 60)));
  }
  function getCortinaTagKey(playlistUri, trackUri) {
    return `${playlistUri}::${trackUri}`;
  }
  function getCortinaTags() {
    try {
      const raw = Spicetify.LocalStorage?.get(CORTINA_TAGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveCortinaTags(tags) {
    Spicetify.LocalStorage?.set(CORTINA_TAGS_KEY, JSON.stringify(tags));
  }
  function isPlaylistUri(uri) {
    return Boolean(uri && (uri.startsWith("spotify:playlist:") || uri.includes("playlist_v2")));
  }
  function isTrackUri(uri) {
    return Boolean(uri && uri.startsWith("spotify:track:"));
  }
  function resolvePlaylistUri(contextUri) {
    if (isPlaylistUri(contextUri)) {
      return contextUri ?? null;
    }
    const playerContextUri = Spicetify.Player?.data?.context_uri;
    if (isPlaylistUri(playerContextUri)) {
      return playerContextUri ?? null;
    }
    return null;
  }
  function tagTrackAsCortina(playlistUri, trackUri) {
    const tags = getCortinaTags();
    tags[getCortinaTagKey(playlistUri, trackUri)] = true;
    saveCortinaTags(tags);
  }
  function untagTrackAsCortina(playlistUri, trackUri) {
    const tags = getCortinaTags();
    delete tags[getCortinaTagKey(playlistUri, trackUri)];
    saveCortinaTags(tags);
  }
  function isTrackTaggedAsCortina(playlistUri, trackUri) {
    const tags = getCortinaTags();
    return Boolean(tags[getCortinaTagKey(playlistUri, trackUri)]);
  }
  function getAlbumArtUrl() {
    const meta = Spicetify.Player?.data?.item?.metadata;
    if (!meta) {
      return null;
    }
    const withUrl = meta;
    return withUrl.image_large_url ?? withUrl.image_xlarge_url ?? withUrl.image_url ?? null;
  }
  function getCurrentTrackMetadata() {
    const meta = Spicetify.Player?.data?.item?.metadata;
    return {
      title: meta?.title ?? "Nothing playing",
      artist: meta?.artist_name ?? ""
    };
  }
  function getCurrentPlaylistName() {
    const pageMeta = Spicetify.Player?.data?.page_metadata;
    const contextMeta = Spicetify.Player?.data?.context_metadata;
    return pageMeta?.title ?? pageMeta?.name ?? contextMeta?.title ?? contextMeta?.name ?? "Current context";
  }
  async function fadeOutAndSkip(fadeSeconds, onProgress) {
    if (isFading) {
      Spicetify.showNotification("Fade already in progress", true);
      return;
    }
    if (!Spicetify.Player) {
      Spicetify.showNotification("Player is not ready", true);
      return;
    }
    const originalVolume = clamp(Spicetify.Player.getVolume(), 0, 1);
    const safeFadeSeconds = Math.max(0, fadeSeconds);
    const steps = Math.max(1, Math.min(120, Math.round(safeFadeSeconds * 10)));
    const stepDelayMs = steps === 0 ? 0 : safeFadeSeconds * 1e3 / steps;
    isFading = true;
    onProgress?.({
      progress: 0,
      remainingSeconds: safeFadeSeconds
    });
    try {
      for (let step = 1; step <= steps; step += 1) {
        const nextVolume = originalVolume * (1 - step / steps);
        Spicetify.Player.setVolume(nextVolume);
        onProgress?.({
          progress: step / steps,
          remainingSeconds: Math.max(0, safeFadeSeconds * (1 - step / steps))
        });
        if (stepDelayMs > 0) {
          await sleep(stepDelayMs);
        }
      }
      Spicetify.Player.setVolume(0);
      await Promise.resolve(Spicetify.Player.next());
      await sleep(NEXT_TRACK_DELAY_MS);
      Spicetify.Player.setVolume(originalVolume);
      onProgress?.({
        progress: 1,
        remainingSeconds: 0
      });
      Spicetify.showNotification("Cortina skipped");
    } catch (error) {
      Spicetify.Player.setVolume(originalVolume);
      Spicetify.showNotification("Cortina fade failed", true);
      console.error(`${APP_NAME} fade failed`, error);
    } finally {
      isFading = false;
      onProgress?.({
        progress: 0,
        remainingSeconds: 0
      });
    }
  }
  function styleButton(button, variant) {
    button.style.border = "none";
    button.style.borderRadius = "999px";
    button.style.padding = "8px 14px";
    button.style.fontSize = "0.85rem";
    button.style.fontWeight = "700";
    button.style.cursor = "pointer";
    button.style.transition = "opacity 120ms ease";
    if (variant === "primary") {
      button.style.background = "var(--spice-button)";
      button.style.color = "var(--spice-button-text)";
    } else {
      button.style.background = "rgba(var(--spice-rgb-text), 0.08)";
      button.style.color = "var(--spice-text)";
    }
  }
  function createPanelManager() {
    const existingRoot = document.getElementById(PANEL_ID);
    if (existingRoot) {
      existingRoot.cortinifyCleanup?.();
      existingRoot.remove();
    }
    const state = {
      visible: getStoredBoolean(PANEL_VISIBLE_KEY, true),
      collapsed: getStoredBoolean(PANEL_COLLAPSED_KEY, false),
      fadeSeconds: getSavedFadeSeconds(),
      running: isFading,
      fadeProgress: 0,
      remainingSeconds: 0,
      pulsePlayed: false
    };
    const root = document.createElement("div");
    root.id = PANEL_ID;
    root.style.position = "fixed";
    root.style.right = "24px";
    root.style.bottom = "104px";
    root.style.zIndex = "99999";
    root.style.transition = "opacity 160ms ease, transform 160ms ease";
    const shell = document.createElement("div");
    shell.style.width = "360px";
    shell.style.maxWidth = "calc(100vw - 32px)";
    shell.style.background = "var(--spice-main)";
    shell.style.color = "var(--spice-text)";
    shell.style.border = "1px solid rgba(var(--spice-rgb-text), 0.08)";
    shell.style.borderRadius = "16px";
    shell.style.boxShadow = "0 18px 48px rgba(0, 0, 0, 0.35)";
    shell.style.backdropFilter = "blur(10px)";
    shell.style.overflow = "hidden";
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "12px";
    header.style.padding = "14px 16px";
    header.style.borderBottom = "1px solid rgba(var(--spice-rgb-text), 0.08)";
    const titleBlock = document.createElement("div");
    titleBlock.style.display = "grid";
    titleBlock.style.gap = "2px";
    const title = document.createElement("div");
    title.textContent = APP_NAME;
    title.style.fontSize = "0.95rem";
    title.style.fontWeight = "700";
    const subtitle = document.createElement("div");
    subtitle.style.display = "none";
    const headerActions = document.createElement("div");
    headerActions.style.display = "flex";
    headerActions.style.gap = "8px";
    const collapseButton = document.createElement("button");
    const closeButton = document.createElement("button");
    styleButton(collapseButton, "secondary");
    styleButton(closeButton, "secondary");
    closeButton.textContent = "Hide";
    const body = document.createElement("div");
    body.style.display = "grid";
    body.style.gap = "8px";
    body.style.padding = "16px";
    const heroCard = document.createElement("div");
    heroCard.style.display = "grid";
    heroCard.style.gap = "6px";
    heroCard.style.padding = "14px";
    heroCard.style.borderRadius = "12px";
    heroCard.style.background = "rgba(var(--spice-rgb-shadow), 0.18)";
    heroCard.style.justifyItems = "center";
    heroCard.style.textAlign = "center";
    const diskStyles = document.createElement("style");
    diskStyles.textContent = `
#${PANEL_ID} .cortinify-disk-outer {
  position: relative;
  width: 212px;
  height: 212px;
  display: flex;
  align-items: center;
  justify-content: center;
}
#${PANEL_ID} .cortinify-progress-ring {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform: rotate(-90deg);
  filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.12));
}
#${PANEL_ID} .cortinify-progress-ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 6;
}
#${PANEL_ID} .cortinify-progress-ring-fill {
  fill: none;
  stroke: var(--spice-button);
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dashoffset 160ms linear, opacity 120ms ease;
  opacity: 0.95;
}
#${PANEL_ID} .cortinify-tonearm {
  position: absolute;
  right: 8px;
  top: 4px;
  width: 86px;
  height: 124px;
  pointer-events: none;
  z-index: 4;
}
#${PANEL_ID} .cortinify-tonearm-base {
  position: absolute;
  right: 0;
  top: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(145deg, rgb(222, 226, 230), rgb(132, 141, 150));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    0 8px 18px rgba(0, 0, 0, 0.35);
}
#${PANEL_ID} .cortinify-tonearm-base::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: rgb(88, 94, 100);
}
#${PANEL_ID} .cortinify-tonearm-bar {
  position: absolute;
  right: 9px;
  top: 14px;
  width: 8px;
  height: 92px;
  border-radius: 999px;
  transform-origin: top center;
  transform: rotate(36deg);
  transition: transform 780ms cubic-bezier(0.22, 1, 0.36, 1);
  background: linear-gradient(180deg, rgb(236, 240, 244), rgb(143, 150, 158));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.75),
    0 3px 10px rgba(0, 0, 0, 0.22);
}
#${PANEL_ID} .cortinify-tonearm.cortinify-tonearm-playing .cortinify-tonearm-bar {
  transform: rotate(20deg);
}
#${PANEL_ID} .cortinify-tonearm-head {
  position: absolute;
  left: 50%;
  bottom: -4px;
  width: 20px;
  height: 16px;
  margin-left: -10px;
  border-radius: 4px 4px 8px 8px;
  background: linear-gradient(180deg, rgb(245, 246, 248), rgb(126, 132, 139));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    0 4px 10px rgba(0, 0, 0, 0.25);
}
#${PANEL_ID} .cortinify-tonearm-head::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -9px;
  width: 2px;
  height: 12px;
  margin-left: -1px;
  background: rgb(234, 238, 242);
}
#${PANEL_ID} .cortinify-platter {
  position: relative;
  width: 184px;
  height: 184px;
  border-radius: 50%;
  padding: 6px;
  background:
    radial-gradient(circle at 30% 26%, rgba(255, 255, 255, 0.22), transparent 28%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.18), rgba(var(--spice-rgb-shadow), 0.48));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -10px 18px rgba(0, 0, 0, 0.24),
    0 12px 30px rgba(0, 0, 0, 0.38);
}
#${PANEL_ID} .cortinify-platter::before {
  content: "";
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.22);
}
#${PANEL_ID} .cortinify-platter::after {
  content: "";
  position: absolute;
  inset: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
}
#${PANEL_ID} .cortinify-disk-spin {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  background:
    radial-gradient(circle at center, rgba(var(--spice-rgb-shadow), 0.15), rgba(var(--spice-rgb-shadow), 0.7));
  animation: cortinify-disk-rot 14s linear infinite;
  animation-play-state: paused;
  box-shadow:
    inset 0 0 0 1px rgba(var(--spice-rgb-text), 0.06),
    inset 0 12px 18px rgba(255, 255, 255, 0.03),
    inset 0 -18px 24px rgba(0, 0, 0, 0.22);
}
#${PANEL_ID} .cortinify-disk-spin.cortinify-disk-playing {
  animation-play-state: running;
}
#${PANEL_ID} .cortinify-disk-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
#${PANEL_ID} .cortinify-disk-grooves {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    repeating-radial-gradient(
      circle at center,
      rgba(255, 255, 255, 0.00) 0 10px,
      rgba(255, 255, 255, 0.07) 10px 11px,
      rgba(255, 255, 255, 0.02) 11px 12px
    );
  mix-blend-mode: soft-light;
  opacity: 0.85;
  pointer-events: none;
}
#${PANEL_ID} .cortinify-disk-sheen {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.15), transparent 38%, transparent 62%, rgba(0, 0, 0, 0.16));
  pointer-events: none;
}
#${PANEL_ID} .cortinify-label {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72px;
  height: 72px;
  margin-left: -36px;
  margin-top: -36px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(var(--spice-rgb-shadow), 0.36), rgba(var(--spice-rgb-shadow), 0.72));
  box-shadow:
    inset 0 0 0 1px rgba(var(--spice-rgb-text), 0.08),
    inset 0 0 0 9px rgba(var(--spice-rgb-text), 0.04),
    inset 0 0 0 20px rgba(var(--spice-rgb-shadow), 0.12);
  z-index: 2;
}
#${PANEL_ID} .cortinify-label::before {
  content: "";
  position: absolute;
  inset: 11px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.20);
}
#${PANEL_ID} .cortinify-label::after {
  content: "";
  position: absolute;
  inset: 24px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.24);
}
#${PANEL_ID} .cortinify-disk-spindle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 24px;
  height: 24px;
  margin-left: -12px;
  margin-top: -12px;
  border-radius: 50%;
  background: var(--spice-main);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.28),
    inset 0 1px 2px rgba(0, 0, 0, 0.35);
  z-index: 2;
  pointer-events: none;
}
#${PANEL_ID} .cortinify-track-meta {
  width: 100%;
  display: grid;
  gap: 8px;
  justify-items: center;
}
#${PANEL_ID} .cortinify-status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  line-height: 1;
  border: 1px solid transparent;
}
#${PANEL_ID} .cortinify-track-title {
  max-width: 100%;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--spice-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PANEL_ID} .cortinify-track-artist {
  max-width: 100%;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--spice-subtext);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PANEL_ID} .cortinify-track-timing {
  display: none;
}
#${PANEL_ID} .cortinify-time-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(var(--spice-rgb-text), 0.08);
  border: 1px solid rgba(var(--spice-rgb-text), 0.08);
  color: var(--spice-subtext);
  font-size: 0.73rem;
  font-weight: 700;
  line-height: 1;
}
@keyframes cortinify-disk-rot {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
`;
    const diskOuter = document.createElement("div");
    diskOuter.className = "cortinify-disk-outer";
    const progressSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    progressSvg.setAttribute("viewBox", "0 0 212 212");
    progressSvg.setAttribute("class", "cortinify-progress-ring");
    const progressTrack = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    progressTrack.setAttribute("class", "cortinify-progress-ring-track");
    progressTrack.setAttribute("cx", "106");
    progressTrack.setAttribute("cy", "106");
    progressTrack.setAttribute("r", "98");
    const progressFill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    progressFill.setAttribute("class", "cortinify-progress-ring-fill");
    progressFill.setAttribute("cx", "106");
    progressFill.setAttribute("cy", "106");
    progressFill.setAttribute("r", "98");
    const progressCircumference = 2 * Math.PI * 98;
    progressFill.style.strokeDasharray = String(progressCircumference);
    progressFill.style.strokeDashoffset = String(progressCircumference);
    progressSvg.append(progressTrack, progressFill);
    const tonearm = document.createElement("div");
    tonearm.className = "cortinify-tonearm";
    const tonearmBase = document.createElement("div");
    tonearmBase.className = "cortinify-tonearm-base";
    const tonearmBar = document.createElement("div");
    tonearmBar.className = "cortinify-tonearm-bar";
    const tonearmHead = document.createElement("div");
    tonearmHead.className = "cortinify-tonearm-head";
    const platter = document.createElement("div");
    platter.className = "cortinify-platter";
    const diskSpin = document.createElement("div");
    diskSpin.className = "cortinify-disk-spin";
    const diskImg = document.createElement("img");
    diskImg.className = "cortinify-disk-img";
    diskImg.alt = "";
    diskImg.draggable = false;
    diskImg.addEventListener("error", () => {
      diskImg.style.opacity = "0";
    });
    const diskGrooves = document.createElement("div");
    diskGrooves.className = "cortinify-disk-grooves";
    const diskSheen = document.createElement("div");
    diskSheen.className = "cortinify-disk-sheen";
    const diskLabel = document.createElement("div");
    diskLabel.className = "cortinify-label";
    const diskSpindle = document.createElement("div");
    diskSpindle.className = "cortinify-disk-spindle";
    const trackMeta = document.createElement("div");
    trackMeta.className = "cortinify-track-meta";
    const statusPill = document.createElement("div");
    statusPill.className = "cortinify-status-pill";
    const trackTitle = document.createElement("div");
    trackTitle.className = "cortinify-track-title";
    const trackArtist = document.createElement("div");
    trackArtist.className = "cortinify-track-artist";
    tonearmBar.append(tonearmHead);
    tonearm.append(tonearmBase, tonearmBar);
    diskSpin.append(diskImg, diskGrooves, diskSheen, diskLabel, diskSpindle);
    platter.append(diskSpin);
    diskOuter.append(progressSvg, platter, tonearm);
    trackMeta.append(statusPill, trackTitle, trackArtist);
    let lastAlbumArtUrl = null;
    const syncAlbumDisk = () => {
      const url = getAlbumArtUrl();
      if (url !== lastAlbumArtUrl) {
        lastAlbumArtUrl = url;
        if (url) {
          diskImg.src = url;
          diskImg.style.opacity = "1";
        } else {
          diskImg.removeAttribute("src");
          diskImg.style.opacity = "0";
        }
      }
      const playing = Spicetify.Player?.isPlaying() ?? false;
      diskSpin.classList.toggle("cortinify-disk-playing", playing);
      tonearm.classList.toggle("cortinify-tonearm-playing", playing);
      const progressPercent = clamp(Spicetify.Player?.getProgressPercent?.() ?? 0, 0, 1);
      progressFill.style.strokeDashoffset = String(
        progressCircumference * (1 - progressPercent)
      );
      const currentTrack = getCurrentTrackMetadata();
      trackTitle.textContent = currentTrack.title;
      trackArtist.textContent = currentTrack.artist;
      trackArtist.style.display = currentTrack.artist ? "block" : "none";
      subtitle.textContent = getCurrentPlaylistName();
      if (state.running) {
        statusPill.textContent = "Fading";
        statusPill.style.color = "rgb(255, 214, 153)";
        statusPill.style.background = "rgba(255, 153, 0, 0.14)";
        statusPill.style.borderColor = "rgba(255, 183, 77, 0.35)";
        statusPill.style.boxShadow = "0 0 14px rgba(255, 166, 0, 0.2), inset 0 0 8px rgba(255, 166, 0, 0.08)";
      } else if (playing) {
        statusPill.textContent = "Playing";
        statusPill.style.color = "rgb(187, 247, 208)";
        statusPill.style.background = "rgba(29, 185, 84, 0.14)";
        statusPill.style.borderColor = "rgba(110, 231, 183, 0.35)";
        statusPill.style.boxShadow = "0 0 14px rgba(29, 185, 84, 0.22), inset 0 0 8px rgba(29, 185, 84, 0.08)";
      } else {
        statusPill.textContent = "Paused";
        statusPill.style.color = "rgb(254, 240, 138)";
        statusPill.style.background = "rgba(234, 179, 8, 0.14)";
        statusPill.style.borderColor = "rgba(250, 204, 21, 0.35)";
        statusPill.style.boxShadow = "0 0 14px rgba(234, 179, 8, 0.18), inset 0 0 8px rgba(234, 179, 8, 0.08)";
      }
    };
    const onPlayerVisuals = () => {
      syncAlbumDisk();
    };
    Spicetify.Player?.addEventListener("songchange", onPlayerVisuals);
    Spicetify.Player?.addEventListener("onplaypause", onPlayerVisuals);
    Spicetify.Player?.addEventListener("onprogress", onPlayerVisuals);
    const controlsCard = document.createElement("div");
    controlsCard.style.display = "grid";
    controlsCard.style.gap = "12px";
    controlsCard.style.padding = "14px";
    controlsCard.style.borderRadius = "12px";
    controlsCard.style.background = "rgba(var(--spice-rgb-shadow), 0.14)";
    controlsCard.style.justifyItems = "center";
    controlsCard.style.textAlign = "center";
    const durationSection = document.createElement("div");
    durationSection.style.display = "grid";
    durationSection.style.gap = "10px";
    durationSection.style.justifyItems = "center";
    const fadeStatus = document.createElement("div");
    fadeStatus.style.display = "none";
    const fadeLineTrack = document.createElement("div");
    fadeLineTrack.style.width = "100%";
    fadeLineTrack.style.height = "4px";
    fadeLineTrack.style.borderRadius = "999px";
    fadeLineTrack.style.background = "rgba(var(--spice-rgb-text), 0.08)";
    fadeLineTrack.style.overflow = "hidden";
    const fadeLineFill = document.createElement("div");
    fadeLineFill.style.width = "0%";
    fadeLineFill.style.height = "100%";
    fadeLineFill.style.borderRadius = "999px";
    fadeLineFill.style.background = "var(--spice-button)";
    fadeLineFill.style.transition = "width 90ms linear, opacity 120ms ease";
    const durationText = document.createElement("div");
    durationText.style.display = "none";
    const durationPill = document.createElement("div");
    durationPill.style.display = "inline-flex";
    durationPill.style.alignItems = "baseline";
    durationPill.style.justifyContent = "center";
    durationPill.style.gap = "4px";
    durationPill.style.padding = "14px 16px";
    durationPill.style.borderRadius = "14px";
    durationPill.style.background = "rgba(var(--spice-rgb-text), 0.08)";
    durationPill.style.border = "1px solid rgba(var(--spice-rgb-text), 0.08)";
    durationPill.style.justifySelf = "center";
    const durationValue = document.createElement("span");
    durationValue.style.fontSize = "1.5rem";
    durationValue.style.fontWeight = "800";
    durationValue.style.lineHeight = "1";
    const durationUnit = document.createElement("span");
    durationUnit.textContent = "s";
    durationUnit.style.color = "var(--spice-subtext)";
    durationUnit.style.fontSize = "0.95rem";
    durationUnit.style.fontWeight = "700";
    const presets = document.createElement("div");
    presets.style.display = "flex";
    presets.style.gap = "8px";
    presets.style.flexWrap = "wrap";
    presets.style.justifyContent = "center";
    const runButton = document.createElement("button");
    styleButton(runButton, "primary");
    runButton.textContent = "Fade out cortina and skip";
    runButton.style.justifySelf = "center";
    const presetButtons = [];
    const presetValues = [5, 8, 10, 15];
    const triggerEndPulse = () => {
      fadeLineTrack.animate(
        [
          {
            transform: "scaleY(1)",
            opacity: 1
          },
          {
            transform: "scaleY(1.8)",
            opacity: 1
          },
          {
            transform: "scaleY(1)",
            opacity: 1
          }
        ],
        {
          duration: 320,
          easing: "ease-out"
        }
      );
      fadeLineFill.animate(
        [
          {
            boxShadow: "0 0 0 rgba(29, 185, 84, 0)"
          },
          {
            boxShadow: "0 0 16px rgba(29, 185, 84, 0.9)"
          },
          {
            boxShadow: "0 0 0 rgba(29, 185, 84, 0)"
          }
        ],
        {
          duration: 420,
          easing: "ease-out"
        }
      );
    };
    const syncDuration = () => {
      durationValue.textContent = state.fadeSeconds.toFixed(1);
      for (let index = 0; index < presetButtons.length; index += 1) {
        const button = presetButtons[index];
        const isActive = Math.abs(state.fadeSeconds - presetValues[index]) < 1e-3;
        button.style.background = isActive ? "var(--spice-button)" : "rgba(var(--spice-rgb-text), 0.08)";
        button.style.color = isActive ? "var(--spice-button-text)" : "var(--spice-text)";
      }
    };
    const syncVisibility = () => {
      root.style.opacity = state.visible ? "1" : "0";
      root.style.transform = state.visible ? "translateY(0)" : "translateY(12px)";
      root.style.pointerEvents = state.visible ? "auto" : "none";
      saveStoredBoolean(PANEL_VISIBLE_KEY, state.visible);
      if (playbarButton) {
        playbarButton.active = state.visible;
      }
    };
    const syncCollapsed = () => {
      body.style.display = state.collapsed ? "none" : "grid";
      collapseButton.textContent = state.collapsed ? "Expand" : "Collapse";
      saveStoredBoolean(PANEL_COLLAPSED_KEY, state.collapsed);
    };
    const syncRunning = () => {
      runButton.disabled = state.running;
      runButton.style.opacity = state.running ? "0.7" : "1";
      runButton.textContent = state.running ? "Fading..." : "Fade out cortina and skip";
      durationPill.style.opacity = state.running ? "0.7" : "1";
      fadeLineTrack.style.opacity = state.running ? "1" : "0.55";
      fadeLineFill.style.opacity = state.running ? "1" : "0.35";
      fadeLineFill.style.width = `${clamp(state.fadeProgress * 100, 0, 100)}%`;
      for (const button of presetButtons) {
        button.disabled = state.running;
        button.style.opacity = state.running ? "0.55" : "1";
      }
    };
    const setDuration = (value) => {
      state.fadeSeconds = clamp(value, 0, 60);
      saveFadeSeconds(state.fadeSeconds);
      syncDuration();
    };
    const setVisible = (value) => {
      state.visible = value;
      syncVisibility();
    };
    for (const seconds of presetValues) {
      const button = document.createElement("button");
      styleButton(button, "secondary");
      button.textContent = `${seconds}s`;
      button.addEventListener("click", () => {
        setDuration(seconds);
      });
      presets.append(button);
      presetButtons.push(button);
    }
    collapseButton.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      syncCollapsed();
    });
    closeButton.addEventListener("click", () => {
      setVisible(false);
    });
    runButton.addEventListener("click", () => {
      void (async () => {
        state.running = true;
        state.fadeProgress = 0;
        state.remainingSeconds = state.fadeSeconds;
        state.pulsePlayed = false;
        syncRunning();
        try {
          await fadeOutAndSkip(state.fadeSeconds, ({ progress, remainingSeconds }) => {
            state.fadeProgress = progress;
            state.remainingSeconds = remainingSeconds;
            if (progress >= 1 && !state.pulsePlayed) {
              state.pulsePlayed = true;
              triggerEndPulse();
            }
            syncRunning();
          });
        } finally {
          state.running = false;
          state.fadeProgress = 0;
          state.remainingSeconds = 0;
          state.pulsePlayed = false;
          syncRunning();
        }
      })();
    });
    titleBlock.append(title, subtitle);
    headerActions.append(collapseButton, closeButton);
    header.append(titleBlock, headerActions);
    heroCard.append(diskStyles, diskOuter, trackMeta);
    fadeLineTrack.append(fadeLineFill);
    durationPill.append(durationValue, durationUnit);
    durationSection.append(fadeStatus, fadeLineTrack, durationText, durationPill, presets);
    controlsCard.append(durationSection, runButton);
    body.append(heroCard, controlsCard);
    shell.append(header, body);
    root.append(shell);
    document.body.append(root);
    root.cortinifyCleanup = () => {
      Spicetify.Player?.removeEventListener("songchange", onPlayerVisuals);
      Spicetify.Player?.removeEventListener("onplaypause", onPlayerVisuals);
      Spicetify.Player?.removeEventListener("onprogress", onPlayerVisuals);
    };
    syncDuration();
    syncCollapsed();
    syncRunning();
    syncVisibility();
    syncAlbumDisk();
    return {
      isVisible: () => state.visible,
      setVisible,
      toggleVisible: () => {
        setVisible(!state.visible);
      },
      sync: () => {
        state.running = isFading;
        syncDuration();
        syncCollapsed();
        syncRunning();
        syncVisibility();
        syncAlbumDisk();
      }
    };
  }
  function registerContextMenus() {
    if (!Spicetify.ContextMenu) {
      return;
    }
    new Spicetify.ContextMenu.Item(
      "Mark as Cortina",
      (uris, _uids, contextUri) => {
        const trackUri = uris[0];
        const playlistUri = resolvePlaylistUri(contextUri);
        if (!playlistUri || !isTrackUri(trackUri)) {
          Spicetify.showNotification("Cortina tag requires a playlist track", true);
          return;
        }
        tagTrackAsCortina(playlistUri, trackUri);
        Spicetify.showNotification("Marked as cortina");
      },
      (uris) => {
        return uris.length === 1 && isTrackUri(uris[0]);
      },
      Spicetify.SVGIcons?.check
    ).register();
    new Spicetify.ContextMenu.Item(
      "Unmark as Cortina",
      (uris, _uids, contextUri) => {
        const trackUri = uris[0];
        const playlistUri = resolvePlaylistUri(contextUri);
        if (!playlistUri || !isTrackUri(trackUri)) {
          Spicetify.showNotification("Cortina tag requires a playlist track", true);
          return;
        }
        untagTrackAsCortina(playlistUri, trackUri);
        Spicetify.showNotification("Removed cortina mark");
      },
      (uris, _uids, contextUri) => {
        const playlistUri = resolvePlaylistUri(contextUri);
        return uris.length === 1 && isTrackUri(uris[0]) && Boolean(playlistUri) && isTrackTaggedAsCortina(playlistUri, uris[0]);
      },
      Spicetify.SVGIcons?.x
    ).register();
  }
  function init() {
    if (initialized) {
      return;
    }
    if (!Spicetify.Platform || !Spicetify.Playbar) {
      setTimeout(init, 300);
      return;
    }
    try {
      panelManager = createPanelManager();
      playbarButton = new Spicetify.Playbar.Button(
        APP_NAME,
        PLAYBAR_ICON,
        () => {
          panelManager?.toggleVisible();
        },
        false,
        panelManager.isVisible(),
        false
      );
      playbarButton.disabled = false;
      playbarButton.element.style.cursor = "pointer";
      playbarButton.register();
      registerContextMenus();
      panelManager.sync();
    } catch (error) {
      console.error(`${APP_NAME} playbar init failed`, error);
      Spicetify.showNotification(`${APP_NAME} failed to load`, true);
      return;
    }
    initialized = true;
    Spicetify.showNotification(`${APP_NAME} loaded`);
  }
  init();
})();
//# sourceMappingURL=cortinify.js.map
