import { categories, collections, resources, siteMeta } from "./data/resources.js";

const state = {
  query: "",
  category: "all",
  platform: "all",
  linkType: "all",
  tag: "all",
};

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
const resourceLookup = new Map(resources.map((resource) => [resource.slug, resource]));

const dom = {
  searchInput: document.querySelector("#search-input"),
  filterToggle: document.querySelector("#filter-toggle"),
  filterPanel: document.querySelector("#filter-panel"),
  resetFiltersButton: document.querySelector("#reset-filters-button"),
  randomPickButton: document.querySelector("#random-pick-button"),
  resultsSummary: document.querySelector("#results-summary"),
  heroStats: document.querySelector("#hero-stats"),
  featuredPreview: document.querySelector("#featured-preview"),
  categoryFilters: document.querySelector("#category-filters"),
  platformFilters: document.querySelector("#platform-filters"),
  linkTypeFilters: document.querySelector("#linktype-filters"),
  tagFilters: document.querySelector("#tag-filters"),
  collectionList: document.querySelector("#collection-list"),
  categoryGrid: document.querySelector("#category-grid"),
  railList: document.querySelector("#section-rail-list"),
  resourceSections: document.querySelector("#resource-sections"),
  recentList: document.querySelector("#recent-list"),
  editorList: document.querySelector("#editor-list"),
};

const availablePlatforms = new Set(resources.flatMap((resource) => resource.platforms));
const availableTags = new Set(resources.flatMap((resource) => resource.tags));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyDate(value) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function buildSearchBlob(resource) {
  const nested = linkTypeOrder.flatMap((type) => {
    if (type === "official") {
      return resource.official ? [resource.official.label, resource.official.url] : [];
    }

    return (resource[type] || []).flatMap((item) => [item.label, item.url]);
  });

  return [
    resource.title,
    resource.summary,
    resource.notes,
    resource.whyItMatters,
    resource.category,
    ...resource.tags,
    ...resource.platforms,
    ...nested,
  ]
    .join(" ")
    .toLowerCase();
}

function resourceHasLinkType(resource, type) {
  if (type === "official") {
    return Boolean(resource.official);
  }

  return Array.isArray(resource[type]) && resource[type].length > 0;
}

function getEssentials(resource) {
  const links = [];

  if (resource.official) {
    links.push(resource.official);
  }

  if (resource.docs?.[0]) {
    links.push(resource.docs[0]);
  }

  if (resource.tools?.[0]) {
    links.push(resource.tools[0]);
  }

  return links.slice(0, 3);
}

function getFilteredResources() {
  const query = state.query.trim().toLowerCase();

  return resources.filter((resource) => {
    if (state.category !== "all" && resource.category !== state.category) {
      return false;
    }

    if (state.platform !== "all" && !resource.platforms.includes(state.platform)) {
      return false;
    }

    if (state.linkType !== "all" && !resourceHasLinkType(resource, state.linkType)) {
      return false;
    }

    if (state.tag !== "all" && !resource.tags.includes(state.tag)) {
      return false;
    }

    if (query && !buildSearchBlob(resource).includes(query)) {
      return false;
    }

    return true;
  });
}

function groupedResources(list) {
  return categories
    .map((category) => ({
      category,
      resources: list.filter((resource) => resource.category === category.slug),
    }))
    .filter((group) => group.resources.length > 0);
}

function getPopularTags() {
  const frequency = new Map();

  resources.forEach((resource) => {
    resource.tags.forEach((tag) => {
      frequency.set(tag, (frequency.get(tag) || 0) + 1);
    });
  });

  return [...frequency.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 14)
    .map(([tag]) => tag);
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

function updateHeroStats() {
  const featuredCount = resources.filter((resource) => resource.featured).length;
  const docsCount = resources.reduce((count, resource) => count + (resource.docs?.length || 0) + (resource.wiki?.length || 0), 0);
  const communityCount = resources.reduce((count, resource) => count + (resource.communities?.length || 0), 0);

  dom.heroStats.innerHTML = `
    <div>
      <dt>Resources</dt>
      <dd>${resources.length}</dd>
    </div>
    <div>
      <dt>Featured</dt>
      <dd>${featuredCount}</dd>
    </div>
    <div>
      <dt>Docs & communities</dt>
      <dd>${docsCount + communityCount}</dd>
    </div>
  `;
}

function renderFeaturedPreview() {
  const previewItems = resources
    .filter((resource) => resource.featured)
    .slice(0, 6)
    .map((resource) => `
      <article class="preview-item">
        <div class="preview-item__meta">
          <span>${escapeHtml(categoryLookup.get(resource.category)?.title || resource.category)}</span>
          <span>${prettyDate(resource.updatedAt)}</span>
        </div>
        <div class="preview-item__title">
          <a href="#${escapeHtml(resource.category)}">${escapeHtml(resource.title)}</a>
        </div>
        <div class="preview-item__meta">
          <span>${escapeHtml(resource.tags.slice(0, 2).join(" / "))}</span>
          <span>${escapeHtml(resource.platforms[0])}</span>
        </div>
      </article>
    `)
    .join("");

  dom.featuredPreview.innerHTML = previewItems;
}

function renderCollections() {
  dom.collectionList.innerHTML = collections
    .map((collection) => {
      const entries = collection.resources.map((slug) => resourceLookup.get(slug)).filter(Boolean);
      const inlineTokens = entries
        .map(
          (resource) =>
            `<a class="inline-token" href="#${escapeHtml(resource.category)}">${escapeHtml(resource.title)}</a>`
        )
        .join("");

      return `
        <article class="collection-strip reveal">
          <div class="collection-strip__content">
            <div class="collection-strip__title">
              <span class="collection-strip__tag">${escapeHtml(collection.accent)}</span>
              <h3>${escapeHtml(collection.title)}</h3>
            </div>
            <p>${escapeHtml(collection.summary)}</p>
            <div class="collection-strip__resources">${inlineTokens}</div>
          </div>
          <div class="collection-strip__actions">
            <button class="button button--tiny" data-collection-open="${escapeHtml(collection.slug)}" type="button">
              Open essentials
            </button>
            <a class="button button--tiny" href="#${escapeHtml(entries[0]?.category || "category-index")}">See collection</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCategoryGrid(filteredGroups) {
  const counts = new Map(filteredGroups.map((group) => [group.category.slug, group.resources.length]));

  dom.categoryGrid.innerHTML = categories
    .map((category) => {
      const count = counts.get(category.slug) || 0;
      return `
        <a class="category-tile" href="#${escapeHtml(category.slug)}">
          <div class="category-tile__head">
            <h3>${escapeHtml(category.title)}</h3>
            <span class="category-tile__count">${count} visible</span>
          </div>
          <p>${escapeHtml(category.description)}</p>
        </a>
      `;
    })
    .join("");
}

function renderRail(filteredGroups) {
  dom.railList.innerHTML = filteredGroups
    .map(
      ({ category, resources: categoryResources }) => `
        <a class="rail-link" href="#${escapeHtml(category.slug)}">
          <span>${escapeHtml(category.title)}</span>
          <span>${categoryResources.length}</span>
        </a>
      `
    )
    .join("");
}

function renderLinkGroup(type, items) {
  const list = type === "official" ? (items ? [items] : []) : items || [];
  if (!list.length) {
    return "";
  }

  return `
    <div class="link-group">
      <div class="link-group__header">
        <span class="link-group__title">${escapeHtml(linkTypeLabels[type])}</span>
        <span class="link-group__count">${list.length}</span>
      </div>
      <div class="link-group__items">
        ${list
          .map(
            (item) => `
              <a class="resource-link resource-link--${escapeHtml(type)}" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
                <span>${escapeHtml(item.label)}</span>
              </a>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderResources(filteredGroups) {
  if (!filteredGroups.length) {
    dom.resourceSections.innerHTML = `
      <section class="resource-section">
        <div class="resource-section__header">
          <div>
            <p class="eyebrow">No match</p>
            <h3>Nothing fits the current filter set</h3>
          </div>
        </div>
        <p class="resource-section__description">
          Try a broader search, reset the filters, or jump back to the category index to browse more freely.
        </p>
      </section>
    `;
    return;
  }

  dom.resourceSections.innerHTML = filteredGroups
    .map(({ category, resources: categoryResources }) => {
      const entries = categoryResources
        .map((resource) => {
          const essentials = getEssentials(resource);
          const metaTokens = [...resource.platforms.slice(0, 3), ...resource.tags.slice(0, 3)]
            .map((item) => `<span class="meta-token">${escapeHtml(item)}</span>`)
            .join("");

          const linkGroups = linkTypeOrder
            .map((type) => renderLinkGroup(type, type === "official" ? resource.official : resource[type]))
            .join("");

          return `
            <article class="resource-entry" id="resource-${escapeHtml(resource.slug)}">
              <div class="resource-entry__main">
                <div class="resource-entry__identity">
                  <div class="resource-entry__label">
                    <h4 class="resource-entry__title">
                      <a href="${escapeHtml(resource.official?.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(
                        resource.title
                      )}</a>
                    </h4>
                    ${resource.featured ? '<span class="resource-entry__badge">Featured</span>' : ""}
                  </div>
                  <p class="resource-entry__summary">${escapeHtml(resource.summary)}</p>
                  <p class="resource-entry__why"><strong>Why it matters:</strong> ${escapeHtml(resource.whyItMatters)}</p>
                  <p class="resource-entry__notes">${escapeHtml(resource.notes)}</p>
                  <div class="resource-entry__meta">${metaTokens}</div>
                  <div class="resource-entry__actions">
                    <button
                      class="button button--tiny"
                      type="button"
                      data-role="open-essentials"
                      data-resource="${escapeHtml(resource.slug)}"
                      ${essentials.length ? "" : "disabled"}
                    >
                      Open essentials
                    </button>
                    <span class="meta-token">Updated ${escapeHtml(prettyDate(resource.updatedAt))}</span>
                  </div>
                </div>
                <div class="link-groups">${linkGroups}</div>
              </div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="resource-section reveal" id="${escapeHtml(category.slug)}">
          <div class="resource-section__header">
            <div>
              <p class="eyebrow">${escapeHtml(category.title)}</p>
              <h3>${escapeHtml(category.title)}</h3>
            </div>
            <p class="resource-section__description">${escapeHtml(category.description)}</p>
          </div>
          ${entries}
        </section>
      `;
    })
    .join("");
}

function renderMiniLists(filteredResources) {
  const recent = [...filteredResources].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 6);
  const picks = filteredResources.filter((resource) => resource.featured).slice(0, 6);

  const buildListMarkup = (list, emptyMessage) => {
    if (!list.length) {
      return `<p class="resource-section__description">${escapeHtml(emptyMessage)}</p>`;
    }

    return list
      .map(
        (resource) => `
          <article class="mini-item">
            <div class="mini-item__headline">
              <a href="#resource-${escapeHtml(resource.slug)}">${escapeHtml(resource.title)}</a>
              <span class="mini-item__meta">${escapeHtml(prettyDate(resource.updatedAt))}</span>
            </div>
            <p>${escapeHtml(resource.summary)}</p>
          </article>
        `
      )
      .join("");
  };

  dom.recentList.innerHTML = buildListMarkup(recent, "Recent updates will appear here once the filtered set has active entries.");
  dom.editorList.innerHTML = buildListMarkup(picks, "Featured picks will show up here when the current filter includes them.");
}

function syncSummary(filteredResources) {
  const fragments = [`${filteredResources.length} resource${filteredResources.length === 1 ? "" : "s"} visible`];

  if (state.query) {
    fragments.push(`query: "${state.query}"`);
  }

  if (state.category !== "all") {
    fragments.push(`category: ${categoryLookup.get(state.category)?.title || state.category}`);
  }

  if (state.platform !== "all") {
    fragments.push(`platform: ${state.platform}`);
  }

  if (state.linkType !== "all") {
    fragments.push(`link type: ${linkTypeLabels[state.linkType]}`);
  }

  if (state.tag !== "all") {
    fragments.push(`tag: ${state.tag}`);
  }

  dom.resultsSummary.textContent = fragments.join(" / ");
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

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  const requestedCategory = params.get("category");
  const requestedPlatform = params.get("platform");
  const requestedType = params.get("type");
  const requestedTag = params.get("tag");

  state.query = params.get("q") || "";
  state.category = requestedCategory && categoryLookup.has(requestedCategory) ? requestedCategory : "all";
  state.platform = requestedPlatform && availablePlatforms.has(requestedPlatform) ? requestedPlatform : "all";
  state.linkType = requestedType && linkTypeOrder.includes(requestedType) ? requestedType : "all";
  state.tag = requestedTag && availableTags.has(requestedTag) ? requestedTag : "all";
}

function renderFilters() {
  buildChipGroup(
    dom.categoryFilters,
    [{ label: "All", value: "all" }, ...categories.map((category) => ({ label: category.title, value: category.slug }))],
    state.category,
    (value) => {
      state.category = value;
      renderApp();
    }
  );

  buildChipGroup(
    dom.platformFilters,
    [
      { label: "All", value: "all" },
      ...[...availablePlatforms].sort((left, right) => left.localeCompare(right))
        .map((platform) => ({ label: platform, value: platform })),
    ],
    state.platform,
    (value) => {
      state.platform = value;
      renderApp();
    }
  );

  buildChipGroup(
    dom.linkTypeFilters,
    [{ label: "All", value: "all" }, ...linkTypeOrder.map((type) => ({ label: linkTypeLabels[type], value: type }))],
    state.linkType,
    (value) => {
      state.linkType = value;
      renderApp();
    }
  );

  buildChipGroup(
    dom.tagFilters,
    [{ label: "All", value: "all" }, ...getPopularTags().map((tag) => ({ label: tag, value: tag }))],
    state.tag,
    (value) => {
      state.tag = value;
      renderApp();
    }
  );

  dom.searchInput.value = state.query;
}

function highlightRailOnScroll() {
  const links = [...document.querySelectorAll(".rail-link")];
  const sections = [...document.querySelectorAll(".resource-section[id]")];

  if (!links.length || !sections.length) {
    return;
  }

  const topOffset = 180;
  let activeId = sections[0].id;

  sections.forEach((section) => {
    if (section.getBoundingClientRect().top - topOffset <= 0) {
      activeId = section.id;
    }
  });

  links.forEach((link) => {
    const matches = link.getAttribute("href") === `#${activeId}`;
    link.classList.toggle("is-active", matches);
  });
}

function revealOnScroll() {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  document.querySelectorAll(".reveal").forEach((element) => {
    if (!element.classList.contains("is-visible")) {
      observer.observe(element);
    }
  });
}

function openLinks(links) {
  const unique = [...new Map(links.map((link) => [link.url, link])).values()];
  unique.forEach((link) => {
    window.open(link.url, "_blank", "noopener,noreferrer");
  });
}

function scrollHashIntoView() {
  if (!window.location.hash) {
    return;
  }

  const target = document.querySelector(window.location.hash);
  if (target) {
    target.scrollIntoView({ block: "start" });
  }
}

function attachEvents(filteredResources) {
  dom.searchInput.oninput = (event) => {
    state.query = event.target.value.trimStart();
    renderApp();
  };

  dom.resetFiltersButton.onclick = () => {
    state.query = "";
    state.category = "all";
    state.platform = "all";
    state.linkType = "all";
    state.tag = "all";
    renderApp();
  };

  dom.filterToggle.onclick = () => {
    const isOpen = dom.filterPanel.classList.toggle("is-open");
    dom.filterToggle.setAttribute("aria-expanded", String(isOpen));
  };

  dom.randomPickButton.onclick = () => {
    if (!filteredResources.length) {
      return;
    }

    const random = filteredResources[Math.floor(Math.random() * filteredResources.length)];
    const target = document.querySelector(`#resource-${random.slug}`);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-highlighted");
    window.setTimeout(() => target.classList.remove("is-highlighted"), 1200);
  };

  document.querySelectorAll("[data-role='open-essentials']").forEach((button) => {
    button.addEventListener("click", () => {
      const resource = resourceLookup.get(button.getAttribute("data-resource"));
      if (!resource) {
        return;
      }

      openLinks(getEssentials(resource));
    });
  });

  document.querySelectorAll("[data-collection-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const collection = collections.find((entry) => entry.slug === button.getAttribute("data-collection-open"));
      if (!collection) {
        return;
      }

      const links = collection.resources
        .map((slug) => resourceLookup.get(slug))
        .filter(Boolean)
        .flatMap((resource) => getEssentials(resource))
        .slice(0, 8);

      openLinks(links);
    });
  });

  window.removeEventListener("scroll", highlightRailOnScroll);
  window.addEventListener("scroll", highlightRailOnScroll, { passive: true });
  highlightRailOnScroll();
}

function renderApp() {
  const filteredResources = getFilteredResources();
  const filteredGroups = groupedResources(filteredResources);

  renderFilters();
  renderCollections();
  renderCategoryGrid(filteredGroups);
  renderRail(filteredGroups);
  renderResources(filteredGroups);
  renderMiniLists(filteredResources);
  syncSummary(filteredResources);
  syncUrl();
  attachEvents(filteredResources);
  revealOnScroll();
}

applyUrlState();
updateHeroStats();
renderFeaturedPreview();
renderApp();
scrollHashIntoView();

document.title = siteMeta.title;
