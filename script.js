/*
  Main script for product selection, search, persistence, and chat.

  Notes for deployment:
  - Do NOT put your OpenAI key in the browser.
  - Deploy the provided Cloudflare Worker (cloudflare-worker.js) and set CF_WORKER_URL
    below to the worker's public URL.
*/

const CF_WORKER_URL = "https://jolly-disk-94be.ykhan2.workers.dev";

/* DOM references */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutine = document.getElementById("generateRoutine");
const clearSelected = document.getElementById("clearSelected");
const searchInput = document.getElementById("searchInput");
const userInput = document.getElementById("userInput");
const rtlToggle = document.getElementById("rtlToggle");

let products = [];
let filtered = [];
let selectedIds = new Set();
let messages = []; // conversation messages (user + assistant)

/* Local storage keys */
const LS_SELECTED = "lb_selected_products_v1";
const LS_MESSAGES = "lb_chat_messages_v1";

/* Utility: fetch product data once */
async function loadProducts() {
  const res = await fetch("products.json");
  const data = await res.json();
  products = data.products || [];
  filtered = products.slice();
  return products;
}

/* Render functions */
function renderProducts(list = filtered) {
  if (!list.length) {
    productsContainer.innerHTML = `<div class="placeholder-message">No products found.</div>`;
    return;
  }

  productsContainer.innerHTML = list
    .map((p) => {
      const isSelected = selectedIds.has(p.id);
      return `
      <article class="product-card ${
        isSelected ? "selected" : ""
      }" tabindex="0" data-id="${p.id}" aria-pressed="${isSelected}">
        <img src="${p.image}" alt="${escapeHtml(p.name)}">
        <div class="product-info">
          <h3>${escapeHtml(p.name)}</h3>
          <p>${escapeHtml(p.brand)}</p>
          <button class="details-btn" data-action="toggle-desc" aria-expanded="false">Details</button>
          <div class="desc" aria-hidden="true">${escapeHtml(
            p.description
          )}</div>
        </div>
      </article>`;
    })
    .join("");

  // wire up events
  productsContainer.querySelectorAll(".product-card").forEach((card) => {
    const id = Number(card.dataset.id);
    card.addEventListener("click", (e) => {
      // ignore clicks on details button
      if (e.target.closest(".details-btn")) return;
      toggleSelect(id, card);
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSelect(id, card);
      }
    });

    const CF_WORKER_URL = "https://jolly-disk-94be.ykhan2.workers.dev/"; // your Cloudflare Worker URL
    const desc = card.querySelector(".desc");
    detailsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const expanded = detailsBtn.getAttribute("aria-expanded") === "true";
      detailsBtn.setAttribute("aria-expanded", String(!expanded));
      desc.setAttribute("aria-hidden", String(expanded));
      card.classList.toggle("expanded");
    });
  });
}

function renderSelected() {
  selectedProductsList.innerHTML = "";
  const selected = products.filter((p) => selectedIds.has(p.id));
  if (!selected.length) {
    selectedProductsList.innerHTML =
      '<div class="placeholder-message">No products selected</div>';
    return;
  }

  selected.forEach((p) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `${escapeHtml(
      p.name
    )} <button aria-label="Remove ${escapeHtml(p.name)}" data-id="${
      p.id
    }">✕</button>`;
    selectedProductsList.appendChild(chip);
    chip.querySelector("button").addEventListener("click", (e) => {
      const id = Number(e.currentTarget.dataset.id);
      deselect(id);
    });
  });
}

function toggleSelect(id, cardEl) {
  if (selectedIds.has(id)) {
    deselect(id);
  } else {
    selectedIds.add(id);
    if (cardEl) cardEl.classList.add("selected");
  }
  persistSelected();
  renderSelected();
}

function deselect(id) {
  selectedIds.delete(id);
  // update card class
  const el = productsContainer.querySelector(`.product-card[data-id="${id}"]`);
  if (el) el.classList.remove("selected");
  persistSelected();
  renderSelected();
}

function clearAllSelected() {
  selectedIds.clear();
  persistSelected();
  renderProducts();
  renderSelected();
}

/* Filtering */
function applyFilters() {
  const q = (searchInput.value || "").trim().toLowerCase();
  const cat = (categoryFilter.value || "").toLowerCase();

  filtered = products.filter((p) => {
    if (cat && cat !== "" && p.category.toLowerCase() !== cat) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  });

  renderProducts(filtered);
}

/* Chat and conversation */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  userInput.value = "";
  await sendConversation();
});

generateRoutine.addEventListener("click", async () => {
  // create a user prompt that asks for a personalized routine using selected products
  const selected = products.filter((p) => selectedIds.has(p.id));
  if (!selected.length) {
    appendSystemNotice(
      "Please select at least one product to generate a routine."
    );
    return;
  }

  const productSummary = selected
    .map((p) => `${p.name} (${p.brand}): ${p.description}`)
    .join("\n");
  const prompt = `Please create a step-by-step personalized skincare/haircare routine using ONLY the selected products below. Provide simple instructions, order of use, times of day (AM/PM), and any warnings or ingredient interactions. Include short, verifiable citations/links when possible and label them 'SOURCES:'.\n\nSelected products:\n${productSummary}`;

  appendMessage("user", prompt);
  await sendConversation();
});

/* send current messages + context to Cloudflare Worker which proxies to OpenAI */
async function sendConversation() {
  // keep a short history to save in localStorage
  const payload = {
    messages: messages.slice(-20),
    products: products.filter((p) => selectedIds.has(p.id)),
    now: new Date().toISOString(),
  };

  showTyping(true);
  try {
    if (!CF_WORKER_URL || CF_WORKER_URL.includes("REPLACE_WITH")) {
      throw new Error(
        "Cloudflare Worker URL not set. Update CF_WORKER_URL in script.js with your worker URL."
      );
    }

    const resp = await fetch(CF_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Read response text and try to parse JSON (worker returns structured JSON on error)
    const respText = await resp.text();
    let respJson = null;
    try {
      respJson = respText ? JSON.parse(respText) : null;
    } catch (e) {
      respJson = null;
    }

    if (!resp.ok) {
      // Try to extract meaningful message from structured error payload
      let errMsg = resp.statusText || `HTTP ${resp.status}`;
      if (respJson && respJson.error) {
        const body = respJson.error.body;
        if (typeof body === "string") {
          errMsg = body;
        } else if (body && body.error && body.error.message) {
          errMsg = body.error.message;
        } else {
          errMsg = JSON.stringify(body || respJson.error);
        }
      } else if (respJson && respJson.message) {
        errMsg = respJson.message;
      } else if (respText) {
        errMsg = respText;
      }

      console.error(
        "Worker returned error:",
        resp.status,
        respJson || respText
      );
      appendSystemNotice("API Error: " + errMsg);
      return;
    }

    const data = respJson || {};
    // Expect data.reply (assistant text) and optional data.citations (array of {title,url})
    const assistantText = data.reply || "No response.";
    appendMessage("assistant", assistantText, data.citations || []);
    persistMessages();
  } catch (err) {
    appendSystemNotice("Error: " + err.message);
  } finally {
    showTyping(false);
  }
}

/* UI helpers for chat messages */
function appendMessage(who, text, citations = []) {
  messages.push({
    role: who === "assistant" ? "assistant" : "user",
    content: text,
    time: new Date().toISOString(),
  });
  renderChat();
  persistMessages();
}

function appendSystemNotice(text) {
  const el = document.createElement("div");
  el.className = "system-notice";
  el.textContent = text;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderChat() {
  chatWindow.innerHTML = "";
  messages.forEach((m) => {
    const msg = document.createElement("div");
    msg.className = m.role === "assistant" ? "chat-assistant" : "chat-user";
    msg.textContent = m.content;
    chatWindow.appendChild(msg);
  });
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showTyping(isTyping) {
  let el = document.getElementById("typingIndicator");
  if (isTyping) {
    if (!el) {
      el = document.createElement("div");
      el.id = "typingIndicator";
      el.className = "typing";
      el.textContent = "Assistant is typing…";
      chatWindow.appendChild(el);
    }
  } else {
    if (el) el.remove();
  }
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Persistence */
function persistSelected() {
  localStorage.setItem(LS_SELECTED, JSON.stringify(Array.from(selectedIds)));
}

function restoreSelected() {
  try {
    const raw = localStorage.getItem(LS_SELECTED);
    if (!raw) return;
    const arr = JSON.parse(raw);
    arr.forEach((id) => selectedIds.add(id));
  } catch (e) {
    /* ignore */
  }
}

function persistMessages() {
  try {
    localStorage.setItem(LS_MESSAGES, JSON.stringify(messages.slice(-50)));
  } catch (e) {}
}

function restoreMessages() {
  try {
    const raw = localStorage.getItem(LS_MESSAGES);
    if (!raw) return;
    messages = JSON.parse(raw) || [];
    renderChat();
  } catch (e) {
    messages = [];
  }
}

/* Small helpers */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* Init */
async function init() {
  await loadProducts();
  restoreSelected();
  restoreMessages();
  applyFilters();
  renderSelected();

  // events
  categoryFilter.addEventListener("change", applyFilters);
  searchInput.addEventListener("input", () => applyFilters());
  clearSelected.addEventListener("click", () => clearAllSelected());

  rtlToggle.addEventListener("click", () => {
    const isPressed = rtlToggle.getAttribute("aria-pressed") === "true";
    rtlToggle.setAttribute("aria-pressed", String(!isPressed));
    const root = document.documentElement;
    if (!isPressed) {
      root.setAttribute("dir", "rtl");
    } else {
      root.removeAttribute("dir");
    }
  });
}

init();
