// فقط برای Accordion: در هر سطح، یک شاخه باز بماند.
document.addEventListener(
  "toggle",
  (event) => {
    const currentGroup = event.target;
    if (!(currentGroup instanceof HTMLDetailsElement) || !currentGroup.open)
      return;
    const parent = currentGroup.parentElement;
    if (!parent) return;
    parent.querySelectorAll(":scope > details[open]").forEach((group) => {
      if (group !== currentGroup) group.open = false;
    });
  },
  true,
);
// Palette: a single base color drives all visual tones through palette.css.
const paletteButton = document.getElementById("paletteButton");
const palettePopup = document.getElementById("palettePopup");
const moreColorButton = document.getElementById("moreColorButton");
const customColorInput = document.getElementById("customColorInput");
const paletteSwatches = [...document.querySelectorAll(".palette-swatch")];
function applyPaletteColor(color) {
  document.documentElement.style.setProperty("--palette-color", color);
  localStorage.setItem("sidebarPaletteColor", color);
  paletteSwatches.forEach((swatch) => {
    swatch.classList.toggle(
      "is-selected",
      swatch.dataset.color.toLowerCase() === color.toLowerCase(),
    );
  });
}
applyPaletteColor(localStorage.getItem("sidebarPaletteColor") || "#285F92");
paletteButton.addEventListener("click", (event) => {
  event.stopPropagation();
  palettePopup.hidden = !palettePopup.hidden;
});
palettePopup.addEventListener("click", (event) => event.stopPropagation());
paletteSwatches.forEach((swatch) =>
  swatch.addEventListener("click", () =>
    applyPaletteColor(swatch.dataset.color),
  ),
);
moreColorButton.addEventListener("click", () => customColorInput.click());
customColorInput.addEventListener("input", () =>
  applyPaletteColor(customColorInput.value),
);
document.addEventListener("click", () => {
  palettePopup.hidden = true;
});
// Tabs: only leaf menu items open tabs; duplicate tabs are not created.
const tabList = document.getElementById("tabList");
const closeAllTabsButton = document.getElementById("closeAllTabsButton");
const contentPanel = document.getElementById("contentPanel");
const contentWelcome = document.getElementById("contentWelcome");
const contentFrame = document.getElementById("contentFrame");
const openTabs = new Map();
let activeTabKey = "";
function getMenuPath(menuItem) {
  const path = [];
  let currentElement = menuItem;
  while (currentElement) {
    if (currentElement.matches?.("a.menu-item")) {
      const label = currentElement
        .querySelector(".menu-item__label")
        ?.textContent.trim();
      if (label) path.unshift(label);
    }
    const parentGroup = currentElement.closest?.("details.menu-group");
    if (!parentGroup) break;
    const parentLabel = parentGroup
      .querySelector(":scope > summary .menu-item__label")
      ?.textContent.trim();
    if (parentLabel) path.unshift(parentLabel);
    currentElement = parentGroup.parentElement;
  }
  return path;
}
function activateTab(tabKey) {
  activeTabKey = tabKey || "";
  openTabs.forEach((tabData, key) => {
    tabData.element.classList.toggle("tab--active", key === activeTabKey);
  });
  const activeTab = openTabs.get(activeTabKey);
  contentWelcome.hidden = !!activeTab;
  contentFrame.hidden = !activeTab;
      if (activeTab && contentFrame.dataset.page !== activeTab.page) {
        contentFrame.src = activeTab.page;  // ← خط 87: صفحه در iframe لود می‌شود
    }
    
  if (activeTab && contentFrame.dataset.page !== activeTab.page) {
    contentFrame.src = activeTab.page;
    contentFrame.dataset.page = activeTab.page;
  }
  if (activeTab)
    activeTab.element.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
}
function closeTab(tabKey) {
  const tabData = openTabs.get(tabKey);
  if (!tabData) return;
  const wasActive = tabKey === activeTabKey;
  const visibleTabs = [...tabList.children];
  const closedIndex = visibleTabs.indexOf(tabData.element);
  tabData.element.remove();
  openTabs.delete(tabKey);
  if (!wasActive) return;
  const remainingKeys = [...openTabs.keys()];
  const nextIndex = Math.min(closedIndex, remainingKeys.length - 1);
  activateTab(remainingKeys[nextIndex] || "");
}

function openTab(menuItem) {
  const path = getMenuPath(menuItem);
  const title =
    menuItem.querySelector(".menu-item__label")?.textContent.trim() ||
    "بدون عنوان";
  const tabKey = path.join(" > ");
  const page = menuItem.getAttribute("href");
  if (openTabs.has(tabKey)) {
    activateTab(tabKey);
    return;
  }
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.setAttribute("role", "tab");
  tab.setAttribute("tabindex", "0");
  tab.title = tabKey;
  const titleElement = document.createElement("span");
  titleElement.className = "tab__title";
  titleElement.textContent = title;
  const closeElement = document.createElement("span");
  closeElement.className = "tab__close";
  closeElement.textContent = "×";
  closeElement.title = "بستن تب";
  tab.append(titleElement, closeElement);
  tabList.appendChild(tab);
  openTabs.set(tabKey, {
    element: tab,
    path,
    page,
  });
  tab.addEventListener("click", (event) => {
    if (event.target === closeElement) {
      event.stopPropagation();
      closeTab(tabKey);
      return;
    }
    activateTab(tabKey);
  });
  tab.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateTab(tabKey);
    }
  });
  activateTab(tabKey);
}

document.querySelectorAll(".sidebar-menu a.menu-item").forEach((menuItem) => {
  menuItem.addEventListener("click", (event) => {
    event.preventDefault();
    openTab(menuItem);
  });
});

closeAllTabsButton.addEventListener("click", () => {
  tabList.replaceChildren();
  openTabs.clear();
  activateTab("");
});
// Header controls: dark/light, language direction and sidebar collapse.
const appLayout = document.querySelector(".app-layout");
const themeButton = document.getElementById("themeButton");
const languageButton = document.getElementById("languageButton");
const languagePopup = document.getElementById("languagePopup");
const languageStatus = document.getElementById("languageStatus");
const sidebarToggleButton = document.getElementById("sidebarToggleButton");
const statusDate = document.getElementById("statusDate");
const statusTime = document.getElementById("statusTime");
function updateStatusClock() {
  const locale = document.documentElement.lang === "en" ? "en-GB" : "fa-IR";
  const now = new Date();
  statusDate.textContent = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  statusTime.textContent = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("sidebarTheme", theme);
}
function applyLanguage(language) {
  const isRtl = language === "fa" || language === "ar";   // fa و ar هر دو RTL
  const isPersian = language === "fa";                     // فقط برای متن‌های فارسی
  document.documentElement.lang = language;
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  localStorage.setItem("sidebarLanguage", language);
  languagePopup.querySelectorAll("[data-language]").forEach((button) => {
    button.classList.toggle(
      "is-selected",
      button.dataset.language === language,
    );
  });
  languageButton.title = isPersian ? "زبان" : "Language";
  languageStatus.textContent = isPersian ? "فارسی" : (language === "ar" ? "العربية" : "English");
  themeButton.title = isPersian ? "شب / روز" : "Dark / Light";
  sidebarToggleButton.title = isPersian
     ? "باز / بسته کردن سایدبار"
    : "Toggle sidebar";
  updateStatusClock();
   
}
function applySidebarState(collapsed) {
  appLayout.classList.toggle("is-sidebar-collapsed", collapsed);
  localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
}
applyTheme(localStorage.getItem("sidebarTheme") || "light");
applyLanguage(localStorage.getItem("sidebarLanguage") || "fa");
applySidebarState(localStorage.getItem("sidebarCollapsed") === "1");
updateStatusClock();
setInterval(updateStatusClock, 1000);
themeButton.addEventListener("click", () => {
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
});
languageButton.addEventListener("click", (event) => {
  event.stopPropagation();
  palettePopup.hidden = true;
  languagePopup.hidden = !languagePopup.hidden;
});
languagePopup.addEventListener("click", (event) => {
  event.stopPropagation();
  const languageOption = event.target.closest("[data-language]");
  if (!languageOption) return;
  applyLanguage(languageOption.dataset.language);
  languagePopup.hidden = true;
});
sidebarToggleButton.addEventListener("click", () => {
  applySidebarState(!appLayout.classList.contains("is-sidebar-collapsed"));
});
document.addEventListener("click", () => {
  languagePopup.hidden = true;
});
