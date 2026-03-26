import { categories, collections, resources, siteMeta } from "./data/resources.js";

const STORAGE_KEY = "netoi-index-v2";
const DEFAULT_VISIBLE_PER_CHAPTER = 6;
const MAX_RECENT = 8;
const MAX_PINNED_PANEL = 6;
const linkTypeOrder = ["official", "tools", "docs", "wiki", "communities", "alternatives"];
const linkTypeLabels = {
  official: "Official",
  tools: "Tools",
  docs: "Docs",
  wiki: "Wiki / Notes",
  communities: "Communities",
  alternatives: "Alternatives",
};

const categoryLookup = new Map(categories.map((category) => [category.slug, category]));
const collectionLookup = new Map(collections.map((collection) => [collection.slug, collection]));
const resourceLookup = new Map(resources.map((resource) => [resource.slug, resource]));

const dom = {
  heroCommandButton: document.querySelector("#hero-command-button"),
  headerCommandButton: document.querySelector("#header-command-button"),
  barCommandButton: document.querySelector("#bar-command-button"),
  headerFilterButton: document.querySelector("#header-filter-button"),
  filterToggle: document.querySelector("#filter-toggle"),
  randomPickButton: document.querySelector("#random-pick-button"),
  archiveSearchInput: document.querySelector("#archive-search-input"),
  resetFiltersButton: document.querySelector("#reset-filters-button"),
  tonightPicks: document.querySelector("#tonight-picks"),
  memoryStrip: document.querySelector("#memory-strip"),
  pinnedCount: document.querySelector("#pinned-count"),
  recentCount: document.querySelector("#recent-count"),
  pinnedStrip: document.querySelector("#pinned-strip"),
  recentlyOpenedStrip: document.querySelector("#recently-opened-strip"),
  chapterPills: document.querySelector("#chapter-pills"),
  archiveSummary: document.querySelector("#archive-summary"),
  filterTray: document.querySelector("#filter-tray"),
  platformFilters: document.querySelector("#platform-filters"),
  linkTypeFilters: document.querySelector("#linktype-filters"),
  tagFilters: document.querySelector("#tag-filters"),
  collectionList: document.querySelector("#collection-list"),
  resourceSections: document.querySelector("#resource-sections"),
  recentList: document.querySelector("#recent-list"),
  revisitList: document.querySelector("#revisit-list"),
  pinsPanel: document.querySelector("#pins-panel"),
  pinsList: document.querySelector("#pins-list"),
  paletteOverlay: document.querySelector("#palette-overlay"),
  paletteInput: document.querySelector("#palette-input"),
  paletteResults: document.querySelector("#palette-results"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean);
}

function prettyDate(value) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getLinksForType(resource, type) {
  if (type === "official") {
    return resource.official ? [resource.official] : [];
  }

  return Array.isArray(resource[type]) ? resource[type] : [];
}

function resolveBestStartingLink(resource) {
  if (resource.bestStartingLink) {
    const links = getLinksForType(resource, resource.bestStartingLink.type);
    if (links[resource.bestStartingLink.index]) {
      return {
        ...links[resource.bestStartingLink.index],
        type: resource.bestStartingLink.type,
      };
    }
  }

  for (const type of ["docs", "tools", "official", "wiki", "communities"]) {
    const first = getLinksForType(resource, type)[0];
    if (first) {
      return { ...first, type };
    }
  }

  return null;
}

function resolveHomepage(resource) {
  return getLinksForType(resource, "official")[0] || resolveBestStartingLink(resource);
}

function getStoredState() {
  const fallback = {
    pins: [],
    recent: [],
    filters: {},
    expandedSections: [],
  };

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return {
      pins: Array.isArray(parsed.pins) ? parsed.pins.filter((slug) => resourceLookup.has(slug)) : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((slug) => resourceLookup.has(slug)).slice(0, MAX_RECENT) : [],
      filters: typeof parsed.filters === "object" && parsed.filters ? parsed.filters : {},
      expandedSections: Array.isArray(parsed.expandedSections)
        ? parsed.expandedSections.filter((slug) => categoryLookup.has(slug))
        : [],
    };
  } catch {
    return fallback;
  }
}

const persisted = getStoredState();
const availablePlatforms = [...new Set(resources.flatMap((resource) => resource.platforms))].sort((left, right) =>
  left.localeCompare(right)
);
const availableTags = [...new Set(resources.flatMap((resource) => resource.tags))]
  .sort((left, right) => left.localeCompare(right))
  .slice(0, 18);

const state = {
  query: "",
  category: "all",
  platform: "all",
  linkType: "all",
  tag: "all",
  filterTrayOpen: false,
  paletteOpen: false,
  paletteQuery: "",
  selectedPaletteIndex: 0,
  currentChapter: "all",
  expandedSections: new Set(persisted.expandedSections),
};

let paletteResults = [];
let revealObserver;

const resourceSearchDocs = resources.map((resource) => {
  const category = categoryLookup.get(resource.category);
  const nestedLabels = linkTypeOrder.flatMap((type) =>
    getLinksForType(resource, type).flatMap((item) => [item.label, item.url])
  );

  return {
    resource,
    title: normalizeText(resource.title),
    labels: normalizeText(resource.labels.join(" ")),
    tags: normalizeText(resource.tags.join(" ")),
    category: normalizeText(category?.title || ""),
    summary: normalizeText(resource.summary),
    notes: normalizeText(`${resource.notes} ${resource.whyItMatters}`),
    links: normalizeText(nestedLabels.join(" ")),
  };
});

const collectionSearchDocs = collections.map((collection) => {
  const resourceTitles = collection.resources
    .map((slug) => resourceLookup.get(slug))
    .filter(Boolean)
    .map((resource) => resource.title)
    .join(" ");

  return {
    collection,
    title: normalizeText(collection.title),
    subtitle: normalizeText(collection.subtitle || ""),
    summary: normalizeText(collection.summary),
    resources: normalizeText(resourceTitles),
  };
});

const categorySearchDocs = categories.map((category) => ({
  category,
  title: normalizeText(category.title),
  description: normalizeText(`${category.description} ${category.shortIntro}`),
}));

function scoreField(normalizedField, tokens, weight, fullQuery) {
  if (!normalizedField) {
    return 0;
  }

  let score = 0;
  let matchedTokens = 0;

  tokens.forEach((token) => {
    if (normalizedField.includes(token)) {
      matchedTokens += 1;
      score += weight;

      if (normalizedField.startsWith(token)) {
        score += weight * 0.35;
      }
    }
  });

  if (matchedTokens === tokens.length && tokens.length > 0) {
    score += weight * 0.6;
  }

  if (fullQuery && normalizedField.includes(fullQuery)) {
    score += weight * 0.8;
  }

  return score;
}

function getResourceSearchScore(resource, query) {
  const fullQuery = normalizeText(query);
  const tokens = tokenize(query);
  if (!tokens.length) {
    return 0;
  }

  const doc = resourceSearchDocs.find((entry) => entry.resource.slug === resource.slug);
  return (
    scoreField(doc.title, tokens, 48, fullQuery) +
    scoreField(doc.labels, tokens, 34, fullQuery) +
    scoreField(doc.tags, tokens, 28, fullQuery) +
    scoreField(doc.category, tokens, 20, fullQuery) +
    scoreField(doc.summary, tokens, 16, fullQuery) +
    scoreField(doc.notes, tokens, 12, fullQuery) +
    scoreField(doc.links, tokens, 10, fullQuery)
  );
}

function getCollectionSearchScore(collection, query) {
  const fullQuery = normalizeText(query);
  const tokens = tokenize(query);
  if (!tokens.length) {
    return 0;
  }

  const doc = collectionSearchDocs.find((entry) => entry.collection.slug === collection.slug);
  return (
    scoreField(doc.title, tokens, 34, fullQuery) +
    scoreField(doc.subtitle, tokens, 18, fullQuery) +
    scoreField(doc.summary, tokens, 14, fullQuery) +
    scoreField(doc.resources, tokens, 12, fullQuery)
  );
}

function getCategorySearchScore(category, query) {
  const fullQuery = normalizeText(query);
  const tokens = tokenize(query);
  if (!tokens.length) {
    return 0;
  }

  const doc = categorySearchDocs.find((entry) => entry.category.slug === category.slug);
  return scoreField(doc.title, tokens, 30, fullQuery) + scoreField(doc.description, tokens, 12, fullQuery);
}

function hasActiveFilters() {
  return Boolean(
    state.query ||
      state.category !== "all" ||
      state.platform !== "all" ||
      state.linkType !== "all" ||
      state.tag !== "all"
  );
}

function hasRefineFilters() {
  return Boolean(state.query || state.platform !== "all" || state.linkType !== "all" || state.tag !== "all");
}

function resourceMatchesState(resource) {
  if (state.category !== "all" && resource.category !== state.category) {
    return false;
  }

  if (state.platform !== "all" && !resource.platforms.includes(state.platform)) {
    return false;
  }

  if (state.linkType !== "all" && !getLinksForType(resource, state.linkType).length) {
    return false;
  }

  if (state.tag !== "all" && !resource.tags.includes(state.tag)) {
    return false;
  }

  if (state.query && getResourceSearchScore(resource, state.query) <= 0) {
    return false;
  }

  return true;
}

function compareResources(left, right) {
  return (
    left.sortRank - right.sortRank ||
    Number(right.featured) - Number(left.featured) ||
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function getFilteredGroups() {
  const visible = resources.filter(resourceMatchesState);

  const sortedVisible = [...visible].sort((left, right) => {
    if (state.query) {
      return (
        getResourceSearchScore(right, state.query) - getResourceSearchScore(left, state.query) ||
        compareResources(left, right)
      );
    }

    return compareResources(left, right);
  });

  return categories
    .map((category) => ({
      category,
      resources: sortedVisible.filter((resource) => resource.category === category.slug),
    }))
    .filter((group) => group.resources.length > 0);
}

function getChapterCountsForBar() {
  return categories.map((category) => ({
    category,
    count: resources.filter((resource) => {
      if (resource.category !== category.slug) {
        return false;
      }

      if (state.platform !== "all" && !resource.platforms.includes(state.platform)) {
        return false;
      }

      if (state.linkType !== "all" && !getLinksForType(resource, state.linkType).length) {
        return false;
      }

      if (state.tag !== "all" && !resource.tags.includes(state.tag)) {
        return false;
      }

      if (state.query && getResourceSearchScore(resource, state.query) <= 0) {
        return false;
      }

      return true;
    }).length,
  }));
}

function getRelatedResources(resource, maxItems = 3) {
  const collected = [];
  const seen = new Set([resource.slug]);

  (resource.related || []).forEach((slug) => {
    const target = resourceLookup.get(slug);
    if (target && !seen.has(target.slug)) {
      seen.add(target.slug);
      collected.push(target);
    }
  });

  if (collected.length >= maxItems) {
    return collected.slice(0, maxItems);
  }

  const fallback = resources
    .filter((candidate) => !seen.has(candidate.slug))
    .map((candidate) => {
      const sharedTags = candidate.tags.filter((tag) => resource.tags.includes(tag)).length;
      const sameCategory = candidate.category === resource.category ? 3 : 0;
      return { candidate, score: sameCategory + sharedTags };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || compareResources(left.candidate, right.candidate))
    .map((entry) => entry.candidate);

  fallback.forEach((candidate) => {
    if (collected.length < maxItems) {
      collected.push(candidate);
      seen.add(candidate.slug);
    }
  });

  return collected;
}

function saveStoredState() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pins: persisted.pins,
        recent: persisted.recent,
        filters: {
          query: state.query,
          category: state.category,
          platform: state.platform,
          linkType: state.linkType,
          tag: state.tag,
        },
        expandedSections: [...state.expandedSections],
      })
    );
  } catch {
    // Ignore localStorage write errors.
  }
}

function applyInitialState() {
  const fromStorage = persisted.filters || {};
  state.query = fromStorage.query || "";
  state.category = categoryLookup.has(fromStorage.category) ? fromStorage.category : "all";
  state.platform = availablePlatforms.includes(fromStorage.platform) ? fromStorage.platform : "all";
  state.linkType = linkTypeOrder.includes(fromStorage.linkType) ? fromStorage.linkType : "all";
  state.tag = availableTags.includes(fromStorage.tag) ? fromStorage.tag : "all";

  const params = new URLSearchParams(window.location.search);
  const requested = {
    query: params.get("q"),
    category: params.get("category"),
    platform: params.get("platform"),
    type: params.get("type"),
    tag: params.get("tag"),
  };

  if (requested.query !== null) {
    state.query = requested.query;
  }
  if (requested.category && (requested.category === "all" || categoryLookup.has(requested.category))) {
    state.category = requested.category;
  }
  if (requested.platform && (requested.platform === "all" || availablePlatforms.includes(requested.platform))) {
    state.platform = requested.platform;
  }
  if (requested.type && (requested.type === "all" || linkTypeOrder.includes(requested.type))) {
    state.linkType = requested.type;
  }
  if (requested.tag && (requested.tag === "all" || availableTags.includes(requested.tag))) {
    state.tag = requested.tag;
  }

  state.filterTrayOpen = hasRefineFilters();
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.query) {
    params.set("q", state.query);
  }
  if (state.category !== "all") {
    params.set("category", state.category);
  }
  if (state.platform !== "all") {
    params.set("platform", state.platform);
  }
  if (state.linkType !== "all") {
    params.set("type", state.linkType);
  }
  if (state.tag !== "all") {
    params.set("tag", state.tag);
  }

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

function updateFilterTrayVisibility() {
  dom.filterTray.classList.toggle("is-open", state.filterTrayOpen);
  dom.headerFilterButton.setAttribute("aria-expanded", String(state.filterTrayOpen));
  dom.filterToggle.setAttribute("aria-expanded", String(state.filterTrayOpen));
}

function buildChipGroup(target, items, activeValue, onSelect) {
  target.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${item.value === activeValue ? " is-active" : ""}`;
    button.textContent = item.label;
    button.setAttribute("aria-pressed", String(item.value === activeValue));
    button.addEventListener("click", () => onSelect(item.value));
    target.append(button);
  });
}

function renderFilterChips() {
  buildChipGroup(
    dom.platformFilters,
    [{ label: "All", value: "all" }, ...availablePlatforms.map((platform) => ({ label: platform, value: platform }))],
    state.platform,
    (value) => {
      state.platform = value;
      state.filterTrayOpen = true;
      renderApp();
    }
  );

  buildChipGroup(
    dom.linkTypeFilters,
    [{ label: "All", value: "all" }, ...linkTypeOrder.map((type) => ({ label: linkTypeLabels[type], value: type }))],
    state.linkType,
    (value) => {
      state.linkType = value;
      state.filterTrayOpen = true;
      renderApp();
    }
  );

  buildChipGroup(
    dom.tagFilters,
    [{ label: "All", value: "all" }, ...availableTags.map((tag) => ({ label: tag, value: tag }))],
    state.tag,
    (value) => {
      state.tag = value;
      state.filterTrayOpen = true;
      renderApp();
    }
  );

  dom.archiveSearchInput.value = state.query;
}

function getTonightResources() {
  return uniqueBy(
    categories.flatMap((category) => (category.featuredSlugs || []).map((slug) => resourceLookup.get(slug)).filter(Boolean)),
    (resource) => resource.slug
  );
}

function renderTonightPicks() {
  const picked = getTonightResources().slice(0, 6);

  dom.tonightPicks.innerHTML = picked
    .map((resource) => {
      const category = categoryLookup.get(resource.category);
      const start = resolveBestStartingLink(resource);

      return `
        <article class="pick-card" style="--chapter-accent: ${escapeHtml(category.accent)}">
          <div class="pick-card__meta">
            <span>${escapeHtml(category.title)}</span>
            <span>${escapeHtml(resource.labels[0] || resource.status)}</span>
          </div>
          <button class="pick-card__title" type="button" data-jump-resource="${escapeHtml(resource.slug)}">
            ${escapeHtml(resource.title)}
          </button>
          <p>${escapeHtml(resource.summary)}</p>
          ${start ? `<button class="pick-card__link" type="button" data-open-best="${escapeHtml(resource.slug)}">${escapeHtml(start.label)}</button>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderMemoryStrip() {
  const pinned = persisted.pins.map((slug) => resourceLookup.get(slug)).filter(Boolean);
  const recent = persisted.recent.map((slug) => resourceLookup.get(slug)).filter(Boolean);
  const hasContent = pinned.length || recent.length;

  dom.memoryStrip.classList.toggle("is-hidden", !hasContent);
  if (!hasContent) {
    return;
  }

  dom.pinnedCount.textContent = `${pinned.length} saved`;
  dom.recentCount.textContent = `${recent.length} recent`;

  const renderMemoryItems = (items, emptyLabel) => {
    if (!items.length) {
      return `<p class="memory-empty">${escapeHtml(emptyLabel)}</p>`;
    }

    return items
      .map(
        (resource) => `
          <div class="memory-chip">
            <button type="button" data-jump-resource="${escapeHtml(resource.slug)}">${escapeHtml(resource.title)}</button>
            <span>${escapeHtml(categoryLookup.get(resource.category)?.title || "")}</span>
          </div>
        `
      )
      .join("");
  };

  dom.pinnedStrip.innerHTML = renderMemoryItems(pinned, "Pin a few resources and they will appear here.");
  dom.recentlyOpenedStrip.innerHTML = renderMemoryItems(recent, "Open resources and the latest ones will show up here.");
}

function renderChapterPills() {
  const counts = getChapterCountsForBar();
  const totalVisible = counts.reduce((sum, entry) => sum + entry.count, 0);
  const activeSlug = state.category !== "all" ? state.category : state.currentChapter;

  dom.chapterPills.innerHTML = `
    <button class="chapter-pill${state.category === "all" ? " is-active" : ""}" type="button" data-category="all">
      <span>All</span>
      <span>${totalVisible}</span>
    </button>
    ${counts
      .map(
        ({ category, count }) => `
          <button
            class="chapter-pill${activeSlug === category.slug ? " is-active" : ""}"
            type="button"
            data-category="${escapeHtml(category.slug)}"
            style="--chapter-accent: ${escapeHtml(category.accent)}"
          >
            <span>${escapeHtml(category.title)}</span>
            <span>${count}</span>
          </button>
        `
      )
      .join("")}
  `;
}

function updateChapterPillHighlight() {
  const activeSlug = state.category !== "all" ? state.category : state.currentChapter;
  dom.chapterPills.querySelectorAll("[data-category]").forEach((button) => {
    const categorySlug = button.getAttribute("data-category");
    const isActive = state.category === "all" ? categorySlug === "all" || categorySlug === activeSlug : categorySlug === state.category;

    if (state.category === "all" && activeSlug !== "all" && categorySlug === "all") {
      button.classList.remove("is-active");
      return;
    }

    button.classList.toggle("is-active", isActive);
  });
}

function renderCollections() {
  dom.collectionList.innerHTML = collections
    .map((collection) => {
      const entries = collection.resources.map((slug) => resourceLookup.get(slug)).filter(Boolean);
      return `
        <article class="collection-card${collection.featured ? " is-featured" : ""}">
          <div class="collection-card__head">
            <p class="collection-card__eyebrow">${escapeHtml(collection.accent)}</p>
            <h3>${escapeHtml(collection.title)}</h3>
            <p class="collection-card__subtitle">${escapeHtml(collection.subtitle || "")}</p>
          </div>
          <p class="collection-card__summary">${escapeHtml(collection.summary)}</p>
          <div class="collection-card__resources">
            ${entries
              .map(
                (resource) => `
                  <button type="button" class="inline-token" data-jump-resource="${escapeHtml(resource.slug)}">
                    ${escapeHtml(resource.title)}
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="collection-card__actions">
            <button class="button button--tiny" type="button" data-open-collection="${escapeHtml(collection.slug)}">Open essentials</button>
            <button class="button button--tiny" type="button" data-jump-collection="${escapeHtml(collection.slug)}">Focus collection</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function buildResultsSummary(groups) {
  const resourceCount = groups.reduce((sum, group) => sum + group.resources.length, 0);
  const chapterCount = groups.length;
  const fragments = [`${resourceCount} resource${resourceCount === 1 ? "" : "s"}`, `${chapterCount} chapter${chapterCount === 1 ? "" : "s"}`];

  if (state.query) {
    fragments.push(`query "${state.query}"`);
  }
  if (state.category !== "all") {
    fragments.push(`chapter ${categoryLookup.get(state.category)?.title || state.category}`);
  }
  if (state.platform !== "all") {
    fragments.push(`platform ${state.platform}`);
  }
  if (state.linkType !== "all") {
    fragments.push(`type ${linkTypeLabels[state.linkType]}`);
  }
  if (state.tag !== "all") {
    fragments.push(`tag ${state.tag}`);
  }

  return fragments.join(" / ");
}

function renderLinkGroups(resource, startLink) {
  return linkTypeOrder
    .map((type) => {
      const links = getLinksForType(resource, type).filter((item) => item.url !== startLink?.url);
      if (!links.length) {
        return "";
      }

      return `
        <div class="resource-row__group">
          <div class="resource-row__group-head">
            <span>${escapeHtml(linkTypeLabels[type])}</span>
            <span>${links.length}</span>
          </div>
          <div class="resource-row__group-links">
            ${links
              .map(
                (link) => `
                  <a
                    class="resource-link resource-link--${escapeHtml(type)}"
                    href="${escapeHtml(link.url)}"
                    target="_blank"
                    rel="noreferrer"
                    data-resource-link="${escapeHtml(resource.slug)}"
                  >
                    ${escapeHtml(link.label)}
                  </a>
                `
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderResourceRow(resource) {
  const startLink = resolveBestStartingLink(resource);
  const homepage = resolveHomepage(resource);
  const related = getRelatedResources(resource, 3);
  const category = categoryLookup.get(resource.category);
  const pinned = persisted.pins.includes(resource.slug);

  return `
    <article class="resource-row" id="resource-${escapeHtml(resource.slug)}">
      <div class="resource-row__identity">
        <div class="resource-row__meta">
          <span class="status-pill">${escapeHtml(resource.status)}</span>
          ${resource.labels.map((label) => `<span class="label-pill">${escapeHtml(label)}</span>`).join("")}
        </div>
        <div class="resource-row__title-wrap">
          <h4 class="resource-row__title">${escapeHtml(resource.title)}</h4>
          <button class="pin-button${pinned ? " is-active" : ""}" type="button" data-toggle-pin="${escapeHtml(resource.slug)}">
            ${pinned ? "Pinned" : "Pin"}
          </button>
        </div>
        <p class="resource-row__summary">${escapeHtml(resource.summary)}</p>
        <p class="resource-row__why"><strong>Why it matters:</strong> ${escapeHtml(resource.whyItMatters)}</p>
        <p class="resource-row__notes">${escapeHtml(resource.notes)}</p>
        <div class="resource-row__foot">
          <span>${escapeHtml(category.title)}</span>
          <span>${escapeHtml(resource.platforms.slice(0, 3).join(" / "))}</span>
          <span>${escapeHtml(prettyDate(resource.updatedAt))}</span>
        </div>
        <div class="resource-row__actions">
          ${startLink ? `<button class="button button--tiny" type="button" data-open-best="${escapeHtml(resource.slug)}">Start here</button>` : ""}
          ${homepage ? `<button class="button button--tiny" type="button" data-open-home="${escapeHtml(resource.slug)}">Homepage</button>` : ""}
          <button class="button button--tiny" type="button" data-jump-resource="${escapeHtml(resource.slug)}">Permalink</button>
        </div>
        ${
          related.length
            ? `
              <div class="resource-row__related">
                <span>Related</span>
                ${related
                  .map(
                    (item) => `
                      <button type="button" class="related-chip" data-jump-resource="${escapeHtml(item.slug)}">
                        ${escapeHtml(item.title)}
                      </button>
                    `
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </div>
      <div class="resource-row__links">
        ${
          startLink
            ? `
              <div class="start-card">
                <div class="start-card__label">Best starting link</div>
                <button class="start-card__button" type="button" data-open-best="${escapeHtml(resource.slug)}">
                  ${escapeHtml(startLink.label)}
                </button>
                <p>${escapeHtml(linkTypeLabels[startLink.type])}</p>
              </div>
            `
            : ""
        }
        <div class="resource-row__group-stack">
          ${renderLinkGroups(resource, startLink)}
        </div>
      </div>
    </article>
  `;
}

function renderArchive(groups) {
  if (!groups.length) {
    dom.resourceSections.innerHTML = `
      <section class="empty-state">
        <p class="eyebrow">No match</p>
        <h3>Nothing fits the current filter set.</h3>
        <p>Try a broader query, reset filters, or jump back to all chapters.</p>
        <div class="empty-state__actions">
          <button class="button button--tiny" type="button" data-reset-filters="true">Reset filters</button>
          <button class="button button--tiny" type="button" data-category="all">Show all chapters</button>
        </div>
      </section>
    `;
    return;
  }

  const forcedExpanded = hasActiveFilters();

  dom.resourceSections.innerHTML = groups
    .map(({ category, resources: chapterResources }) => {
      const expanded = forcedExpanded || state.expandedSections.has(category.slug) || chapterResources.length <= DEFAULT_VISIBLE_PER_CHAPTER;
      const visibleResources = expanded ? chapterResources : chapterResources.slice(0, DEFAULT_VISIBLE_PER_CHAPTER);

      return `
        <section class="chapter reveal" id="${escapeHtml(category.slug)}" style="--chapter-accent: ${escapeHtml(category.accent)}">
          <header class="chapter__head">
            <div class="chapter__identity">
              <p class="eyebrow">${escapeHtml(category.title)}</p>
              <h3>${escapeHtml(category.title)}</h3>
            </div>
            <p class="chapter__intro">${escapeHtml(category.shortIntro)}</p>
            <div class="chapter__controls">
              <span>${chapterResources.length} visible</span>
              ${
                chapterResources.length > DEFAULT_VISIBLE_PER_CHAPTER
                  ? `<button class="chapter-toggle" type="button" data-toggle-section="${escapeHtml(category.slug)}" ${forcedExpanded ? "disabled" : ""}>
                      ${forcedExpanded ? "Expanded by filters" : expanded ? "Collapse" : "Show all"}
                    </button>`
                  : ""
              }
            </div>
          </header>
          <div class="chapter__shelf">
            ${visibleResources.map((resource) => renderResourceRow(resource)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderMiniList(items, emptyLabel) {
  if (!items.length) {
    return `<p class="mini-empty">${escapeHtml(emptyLabel)}</p>`;
  }

  return items
    .map(
      (resource) => `
        <article class="mini-item">
          <div class="mini-item__head">
            <button type="button" data-jump-resource="${escapeHtml(resource.slug)}">${escapeHtml(resource.title)}</button>
            <span>${escapeHtml(prettyDate(resource.updatedAt))}</span>
          </div>
          <p>${escapeHtml(resource.summary)}</p>
        </article>
      `
    )
    .join("");
}

function renderSignalPanels(groups) {
  const recent = [...resources].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 6);
  const revisit = [...resources]
    .filter((resource) => resource.featured || resource.labels.includes("Personal Pick") || resource.labels.includes("Docs Worth Reading"))
    .sort(compareResources)
    .slice(0, 6);
  const pins = persisted.pins.map((slug) => resourceLookup.get(slug)).filter(Boolean).slice(0, MAX_PINNED_PANEL);

  dom.recentList.innerHTML = renderMiniList(recent, "New additions will appear here as the archive grows.");
  dom.revisitList.innerHTML = renderMiniList(revisit, "High-signal picks will appear here.");
  dom.pinsPanel.classList.toggle("is-hidden", !pins.length);
  dom.pinsList.innerHTML = renderMiniList(pins, "Pin resources to create a personal shortlist.");
  dom.archiveSummary.textContent = buildResultsSummary(groups);
}

function getActionItems() {
  return [
    {
      id: "action-random",
      title: "Random pick",
      meta: "Jump to a random visible resource",
      execute: () => pickRandomVisibleResource(),
    },
    {
      id: "action-reset",
      title: "Reset filters",
      meta: "Clear query, tags, platform, and chapter focus",
      execute: () => resetFilters(),
    },
    {
      id: "action-open-filters",
      title: "Open advanced filters",
      meta: "Reveal archive search, platform, type, and tag controls",
      execute: () => {
        state.filterTrayOpen = true;
        renderApp();
        document.querySelector("#chapter-bar")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
  ];
}

function buildPaletteResults(query) {
  const resourceItems = (query
    ? resources
        .map((resource) => ({ resource, score: getResourceSearchScore(resource, query) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || compareResources(left.resource, right.resource))
        .slice(0, 8)
        .map((entry) => entry.resource)
    : getTonightResources().slice(0, 6)
  ).map((resource) => ({
    key: `resource-${resource.slug}`,
    group: "Resources",
    title: resource.title,
    meta: `${categoryLookup.get(resource.category)?.title || ""} / ${resource.labels[0] || resource.status}`,
    enter: () => jumpToResource(resource.slug),
    shiftEnter: () => openBestStartingLink(resource.slug),
    secondaryLabel: "Home",
    secondary: () => openHomepageLink(resource.slug),
  }));

  const collectionItems = (query
    ? collections
        .map((collection) => ({ collection, score: getCollectionSearchScore(collection, query) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || Number(right.collection.featured) - Number(left.collection.featured))
        .slice(0, 4)
        .map((entry) => entry.collection)
    : collections.filter((collection) => collection.featured)
  ).map((collection) => ({
    key: `collection-${collection.slug}`,
    group: "Collections",
    title: collection.title,
    meta: collection.subtitle || collection.summary,
    enter: () => focusCollection(collection.slug),
    shiftEnter: () => openCollectionEssentials(collection.slug),
    secondaryLabel: "Open set",
    secondary: () => openCollectionEssentials(collection.slug),
  }));

  const categoryItems = (query
    ? categories
        .map((category) => ({ category, score: getCategorySearchScore(category, query) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.category)
    : categories
  ).map((category) => ({
    key: `category-${category.slug}`,
    group: "Categories",
    title: category.title,
    meta: category.shortIntro,
    enter: () => setCategory(category.slug),
  }));

  const actionItems = getActionItems()
    .filter((action) => !query || normalizeText(`${action.title} ${action.meta}`).includes(normalizeText(query)))
    .map((action) => ({
      key: action.id,
      group: "Actions",
      title: action.title,
      meta: action.meta,
      enter: action.execute,
    }));

  return [...resourceItems, ...collectionItems, ...categoryItems, ...actionItems];
}

function renderPalette() {
  paletteResults = buildPaletteResults(state.paletteQuery);
  state.selectedPaletteIndex = clamp(state.selectedPaletteIndex, 0, Math.max(paletteResults.length - 1, 0));

  const groups = ["Resources", "Collections", "Categories", "Actions"];
  dom.paletteResults.innerHTML = groups
    .map((group) => {
      const items = paletteResults.filter((item) => item.group === group);
      if (!items.length) {
        return "";
      }

      return `
        <section class="palette-group">
          <div class="palette-group__title">${escapeHtml(group)}</div>
          <div class="palette-group__items">
            ${items
              .map((item) => {
                const index = paletteResults.findIndex((candidate) => candidate.key === item.key);
                return `
                  <div class="palette-item-row${index === state.selectedPaletteIndex ? " is-selected" : ""}" data-index="${index}">
                    <button class="palette-item" type="button" data-index="${index}">
                      <span class="palette-item__title">${escapeHtml(item.title)}</span>
                      <span class="palette-item__meta">${escapeHtml(item.meta)}</span>
                    </button>
                    ${
                      item.secondary
                        ? `<button class="palette-item__secondary" type="button" data-secondary-index="${index}">${escapeHtml(item.secondaryLabel)}</button>`
                        : ""
                    }
                  </div>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");

  if (!paletteResults.length) {
    dom.paletteResults.innerHTML = `
      <section class="palette-group">
        <div class="palette-group__title">No results</div>
        <div class="palette-empty">Try a broader search or reset the archive filters.</div>
      </section>
    `;
  }
}

function setPaletteOpen(nextOpen) {
  state.paletteOpen = nextOpen;
  dom.paletteOverlay.classList.toggle("is-hidden", !nextOpen);
  dom.paletteOverlay.setAttribute("aria-hidden", String(!nextOpen));
  document.body.classList.toggle("palette-open", nextOpen);

  if (nextOpen) {
    renderPalette();
    window.setTimeout(() => dom.paletteInput.focus(), 0);
  }
}

function executePaletteItem(index, useShift = false, useSecondary = false) {
  const item = paletteResults[index];
  if (!item) {
    return;
  }

  if (useSecondary && item.secondary) {
    item.secondary();
  } else if (useShift && item.shiftEnter) {
    item.shiftEnter();
  } else {
    item.enter();
  }

  setPaletteOpen(false);
}

function recordRecent(resourceSlug) {
  persisted.recent = [resourceSlug, ...persisted.recent.filter((slug) => slug !== resourceSlug)].slice(0, MAX_RECENT);
}

function openLink(link, resourceSlug) {
  if (!link) {
    return;
  }

  recordRecent(resourceSlug);
  saveStoredState();
  window.open(link.url, "_blank", "noopener,noreferrer");
}

function openBestStartingLink(resourceSlug) {
  const resource = resourceLookup.get(resourceSlug);
  if (resource) {
    openLink(resolveBestStartingLink(resource), resource.slug);
    renderApp();
  }
}

function openHomepageLink(resourceSlug) {
  const resource = resourceLookup.get(resourceSlug);
  if (resource) {
    openLink(resolveHomepage(resource), resource.slug);
    renderApp();
  }
}

function openCollectionEssentials(collectionSlug) {
  const collection = collectionLookup.get(collectionSlug);
  if (!collection) {
    return;
  }

  uniqueBy(
    collection.resources
      .map((slug) => resourceLookup.get(slug))
      .filter(Boolean)
      .map((resource) => ({ resource, link: resolveBestStartingLink(resource) }))
      .filter((entry) => entry.link),
    (entry) => entry.link.url
  )
    .slice(0, 8)
    .forEach((entry) => openLink(entry.link, entry.resource.slug));
}

function togglePin(resourceSlug) {
  if (persisted.pins.includes(resourceSlug)) {
    persisted.pins = persisted.pins.filter((slug) => slug !== resourceSlug);
  } else {
    persisted.pins = [resourceSlug, ...persisted.pins].slice(0, 12);
  }

  saveStoredState();
  renderApp();
}

function syncHash(targetId) {
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${targetId}`);
}

function jumpToResource(resourceSlug) {
  const resource = resourceLookup.get(resourceSlug);
  if (!resource) {
    return;
  }

  if (!resourceMatchesState(resource)) {
    state.query = "";
    state.platform = "all";
    state.linkType = "all";
    state.tag = "all";
  }

  state.category = resource.category;
  state.expandedSections.add(resource.category);
  saveStoredState();
  renderApp();

  const target = document.querySelector(`#resource-${resourceSlug}`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-highlighted");
    window.setTimeout(() => target.classList.remove("is-highlighted"), 1200);
    syncHash(`resource-${resourceSlug}`);
  }
}

function focusCollection(collectionSlug) {
  document.querySelector("#collections")?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => {
    const target = dom.collectionList.querySelector(`[data-jump-collection="${collectionSlug}"]`)?.closest(".collection-card");
    if (target) {
      target.classList.add("is-highlighted");
      window.setTimeout(() => target.classList.remove("is-highlighted"), 1200);
    }
  }, 150);
}

function resetFilters() {
  state.query = "";
  state.category = "all";
  state.platform = "all";
  state.linkType = "all";
  state.tag = "all";
  state.filterTrayOpen = false;
  renderApp();
}

function setCategory(categorySlug) {
  state.category = categorySlug;
  renderApp();
  document.querySelector("#archive")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function pickRandomVisibleResource() {
  const visible = getFilteredGroups().flatMap((group) => group.resources);
  if (!visible.length) {
    return;
  }

  jumpToResource(visible[Math.floor(Math.random() * visible.length)].slug);
}

function observeRevealElements() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
  }

  document.querySelectorAll(".reveal:not(.is-visible)").forEach((element) => revealObserver.observe(element));
}

function updateCurrentChapterFromScroll() {
  if (state.category !== "all") {
    state.currentChapter = state.category;
    updateChapterPillHighlight();
    return;
  }

  const chapters = [...document.querySelectorAll(".chapter[id]")];
  if (!chapters.length) {
    return;
  }

  let current = "all";
  chapters.forEach((chapter) => {
    if (chapter.getBoundingClientRect().top <= 180) {
      current = chapter.id;
    }
  });

  if (current !== state.currentChapter) {
    state.currentChapter = current;
    updateChapterPillHighlight();
  }
}

function bindDynamicInteractions() {
  dom.chapterPills.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.getAttribute("data-category");
      renderApp();
      document.querySelector("#archive")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll(".empty-state [data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.getAttribute("data-category");
      renderApp();
    });
  });

  dom.collectionList.querySelectorAll("[data-open-collection]").forEach((button) => {
    button.addEventListener("click", () => openCollectionEssentials(button.getAttribute("data-open-collection")));
  });

  dom.collectionList.querySelectorAll("[data-jump-collection]").forEach((button) => {
    button.addEventListener("click", () => focusCollection(button.getAttribute("data-jump-collection")));
  });

  document.querySelectorAll("[data-jump-resource]").forEach((button) => {
    button.addEventListener("click", () => jumpToResource(button.getAttribute("data-jump-resource")));
  });

  document.querySelectorAll("[data-open-best]").forEach((button) => {
    button.addEventListener("click", () => openBestStartingLink(button.getAttribute("data-open-best")));
  });

  document.querySelectorAll("[data-open-home]").forEach((button) => {
    button.addEventListener("click", () => openHomepageLink(button.getAttribute("data-open-home")));
  });

  document.querySelectorAll("[data-toggle-pin]").forEach((button) => {
    button.addEventListener("click", () => togglePin(button.getAttribute("data-toggle-pin")));
  });

  document.querySelectorAll("[data-toggle-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const slug = button.getAttribute("data-toggle-section");
      if (state.expandedSections.has(slug)) {
        state.expandedSections.delete(slug);
      } else {
        state.expandedSections.add(slug);
      }
      saveStoredState();
      renderApp();
    });
  });

  document.querySelectorAll("[data-reset-filters]").forEach((button) => button.addEventListener("click", resetFilters));

  document.querySelectorAll("a[data-resource-link]").forEach((link) => {
    link.addEventListener("click", () => {
      recordRecent(link.getAttribute("data-resource-link"));
      saveStoredState();
      renderMemoryStrip();
    });
  });
}

function renderApp() {
  const groups = getFilteredGroups();
  renderTonightPicks();
  renderMemoryStrip();
  renderFilterChips();
  renderCollections();
  renderArchive(groups);
  renderSignalPanels(groups);
  renderChapterPills();
  updateChapterPillHighlight();
  updateFilterTrayVisibility();
  bindDynamicInteractions();
  syncUrl();
  saveStoredState();
  observeRevealElements();
  updateCurrentChapterFromScroll();
}

function handleGlobalShortcuts(event) {
  const isEditable =
    event.target instanceof HTMLElement &&
    (event.target.closest("input, textarea, select") || event.target.isContentEditable);

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    setPaletteOpen(true);
    return;
  }

  if (!isEditable && event.key === "/") {
    event.preventDefault();
    setPaletteOpen(true);
    return;
  }

  if (!state.paletteOpen) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    setPaletteOpen(false);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.selectedPaletteIndex = clamp(state.selectedPaletteIndex + 1, 0, Math.max(paletteResults.length - 1, 0));
    renderPalette();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.selectedPaletteIndex = clamp(state.selectedPaletteIndex - 1, 0, Math.max(paletteResults.length - 1, 0));
    renderPalette();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    executePaletteItem(state.selectedPaletteIndex, event.shiftKey);
  }
}

function bindStaticEvents() {
  [dom.heroCommandButton, dom.headerCommandButton, dom.barCommandButton].forEach((button) => {
    button.addEventListener("click", () => setPaletteOpen(true));
  });

  [dom.headerFilterButton, dom.filterToggle].forEach((button) => {
    button.addEventListener("click", () => {
      state.filterTrayOpen = !state.filterTrayOpen;
      renderApp();
    });
  });

  dom.randomPickButton.addEventListener("click", pickRandomVisibleResource);

  dom.archiveSearchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trimStart();
    state.filterTrayOpen = true;
    renderApp();
  });

  dom.resetFiltersButton.addEventListener("click", resetFilters);

  dom.paletteInput.addEventListener("input", (event) => {
    state.paletteQuery = event.target.value;
    state.selectedPaletteIndex = 0;
    renderPalette();
  });

  dom.paletteResults.addEventListener("mouseover", (event) => {
    const row = event.target.closest("[data-index]");
    if (!row) {
      return;
    }

    state.selectedPaletteIndex = Number(row.getAttribute("data-index"));
    renderPalette();
  });

  dom.paletteResults.addEventListener("click", (event) => {
    const secondary = event.target.closest("[data-secondary-index]");
    if (secondary) {
      executePaletteItem(Number(secondary.getAttribute("data-secondary-index")), false, true);
      return;
    }

    const primary = event.target.closest("[data-index]");
    if (primary) {
      executePaletteItem(Number(primary.getAttribute("data-index")));
    }
  });

  dom.paletteOverlay.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-palette='true']")) {
      setPaletteOpen(false);
    }
  });

  window.addEventListener("keydown", handleGlobalShortcuts);
  window.addEventListener("scroll", updateCurrentChapterFromScroll, { passive: true });
}

document.title = siteMeta.title;
applyInitialState();
bindStaticEvents();
renderApp();
