/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

/* Learn More toggle */
const learnMoreToggle = document.getElementById("learnMoreToggle");

/* Cloudflare Worker base URL - your provided endpoint */
const API_BASE = "https://loreallll.templeal.workers.dev";

/* Conversation history to keep context for follow-ups during the session */
const defaultSystemMessage = {
  role: "system",
  content:
    "You are an assistant that answers questions about L'Oréal products, routines, and closely related topics (skincare, haircare, makeup, fragrance). When the user provides a list of products (for example when generating a routine), assume the provided product entries are to be considered for the routine and include them. Do NOT omit or exclude products from the routine. If a user asks about another brand or an unrelated topic outside beauty, politely decline. Use the conversation history to provide relevant, concise answers about the generated routine or L'Oréal products.",
};

const messagesHistory = [defaultSystemMessage];

// persistence helpers for messagesHistory and selectedProducts
function saveMessagesHistory() {
  try {
    // persist a sanitized copy: strip out any internal generation instructions or large JSON payloads
    const sanitized = messagesHistory.filter((m) => {
      if (!m || !m.role || !m.content) return false;
      // keep system, user, assistant generally, but exclude internal generation prompts
      if (m.role === "user" && isInternalInstruction(m.content)) return false;
      return true;
    });
    localStorage.setItem("messagesHistory", JSON.stringify(sanitized));
  } catch (err) {
    console.warn("Could not save messagesHistory", err);
  }
}

function loadMessagesHistory() {
  try {
    const raw = localStorage.getItem("messagesHistory");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    // replace in-place to keep the same array reference
    messagesHistory.length = 0;
    // if the first item isn't a system message, ensure the default system is present
    if (parsed[0]?.role !== "system") {
      messagesHistory.push(defaultSystemMessage);
    }
    // filter any stored internal instructions just in case
    const filtered = parsed.filter(
      (m) => !(m.role === "user" && isInternalInstruction(m.content))
    );
    filtered.forEach((m) => messagesHistory.push(m));
    return true;
  } catch (err) {
    console.warn("Could not load messagesHistory", err);
    return false;
  }
}

/* Detect internal generation instructions or payloads that should not be shown to users */
function isInternalInstruction(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  // heuristics: contains a products JSON payload, or obvious generation prompt markers
  if (
    t.includes('"products":') ||
    t.includes("format the response in markdown") ||
    /please generate/i.test(t)
  )
    return true;
  // very long single-line JSON-like strings
  if (t.length > 2000 && (t.trim().startsWith("{") || t.trim().startsWith("[")))
    return true;
  return false;
}

// Simple client-side heuristics for rejecting out-of-scope questions quickly
const OUT_OF_SCOPE_BRANDS = [
  "maybelline",
  "mac",
  "clinique",
  "estee",
  "estée",
  "nars",
  "revlon",
  "covergirl",
  "benefit",
  "sephora",
  "nyx",
  "bareminerals",
];

function isAllowedQuestion(text) {
  if (!text || !text.trim()) return false;
  const t = text.toLowerCase();

  // Block a few clearly non-beauty topics so the assistant stays on-topic
  const nonBeautyTerms = [
    "weather",
    "politics",
    "stock",
    "crypto",
    "bitcoin",
    "sports",
    "soccer",
    "football",
    "programming",
    "code",
    "recipe",
    "cooking",
  ];
  for (const nb of nonBeautyTerms) if (t.includes(nb)) return false;

  // If user explicitly mentions L'Oréal, always allow
  if (t.includes("l'oreal") || t.includes("loreal")) return true;

  // Allow follow-ups after a routine is generated
  if (routineGenerated) return true;

  // Broad list of beauty-related terms we consider in-scope. This is intentionally
  // generous so questions like "What is a good mascara?" will be answered with
  // L'Oréal-focused suggestions rather than declined.
  const beautyTerms = [
    "skincare",
    "haircare",
    "makeup",
    "fragrance",
    "routine",
    "product",
    "sunscreen",
    "serum",
    "cleanser",
    "moisturizer",
    "mascara",
    "foundation",
    "lipstick",
    "eyeliner",
    "eyebrow",
    "concealer",
    "primer",
    "toner",
    "exfoli",
    "spf",
    "conditioner",
    "shampoo",
    "styling",
    "volum",
    "curl",
    "frizz",
    "heat protect",
    "blow",
    "brush",
    "serum",
    "retinol",
    "vitamin c",
    "niacinamide",
    "ceramide",
    "mask",
    "sheet",
    "cleanse",
  ];
  for (const term of beautyTerms) if (t.includes(term)) return true;

  // allow if it references any selected product by name
  for (const p of selectedProducts) {
    if (!p || !p.name) continue;
    if (t.includes(p.name.toLowerCase())) return true;
  }

  // default: deny if it doesn't look like a beauty question
  return false;
}

/* Helpers for friendly local responses */
function isGreeting(text) {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return /^(hi|hello|hey|hiya|good morning|good afternoon|good evening)([!.,]?\s*)?$/.test(
    t
  );
}

function isNameIntro(text) {
  if (!text) return false;
  return /\b(my name is|i am|i'm|im)\b/i.test(text);
}

function parseNameFromIntro(text) {
  const m = text.match(/\b(?:my name is|i am|i'm|im)\s+(.+)$/i);
  if (!m) return null;
  // take first part before punctuation
  return m[1].trim().replace(/[.!?]$/, "");
}

/* State for product selection */
const selectedProductsListEl = document.getElementById("selectedProductsList");
let selectedProducts = []; // array of product objects selected by the user
let lastDisplayedProducts = [];
// flag set when a routine has been generated during this session
let routineGenerated = false;

function saveSelectedProducts() {
  try {
    localStorage.setItem("selectedProducts", JSON.stringify(selectedProducts));
  } catch (err) {
    console.warn("Could not save selectedProducts", err);
  }
}

function loadSelectedProducts() {
  try {
    const raw = localStorage.getItem("selectedProducts");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    selectedProducts = parsed;
    return true;
  } catch (err) {
    console.warn("Could not load selectedProducts", err);
    return false;
  }
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  // keep a reference to the products we just rendered so selection can map back
  lastDisplayedProducts = products;

  productsContainer.innerHTML = products
    .map(
      (product, idx) => `
    <div class="product-card" data-index="${idx}" role="button" tabindex="0" aria-pressed="false">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
      </div>
      <div class="product-desc" aria-hidden="true">${
        product.description || ""
      }</div>
    </div>
  `
    )
    .join("");

  // ensure any previously selected items still show as selected if they are visible
  selectedProducts.forEach((p) => {
    // try to find matching card in the current view by name (fallback)
    const idx = lastDisplayedProducts.findIndex(
      (lp) => lp.id === p.id || lp.name === p.name
    );
    if (idx >= 0) {
      const el = productsContainer.querySelector(
        `.product-card[data-index="${idx}"]`
      );
      if (el) el.classList.add("selected");
    }
  });
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  const selectedCategory = e.target.value;

  /* filter() creates a new array containing only products 
     where the category matches what the user selected */
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory
  );

  displayProducts(filteredProducts);
});

/* Helper to append messages to the chat window */
function appendChatMessage(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message chat-${role}`;
  const p = document.createElement("p");
  p.textContent = text;
  wrapper.appendChild(p);
  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return wrapper;
}

/* Learn More mode handling (persisted) */
function setLearnMore(enabled) {
  document.body.classList.toggle("learn-more-enabled", !!enabled);
  if (learnMoreToggle) {
    learnMoreToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    learnMoreToggle.classList.toggle("active", !!enabled);
    learnMoreToggle.textContent = enabled ? "Info Mode: On" : "Info Mode";
  }
  try {
    localStorage.setItem("learnMore", enabled ? "true" : "false");
  } catch (err) {
    // ignore storage errors
  }
}

// initialize from localStorage
try {
  const saved = localStorage.getItem("learnMore");
  setLearnMore(saved === "true");
} catch (err) {
  setLearnMore(false);
}

if (learnMoreToggle) {
  learnMoreToggle.addEventListener("click", () => {
    const enabled = !document.body.classList.contains("learn-more-enabled");
    setLearnMore(enabled);
  });
}

// Show a friendly startup welcome message and record it in conversation history
const startupWelcome =
  "Hi — welcome! I can help you build a personalized routine with L'Oréal products. Select some products and click \"Generate Routine\", or ask me about L'Oréal skincare, haircare, makeup, or fragrance.";
// Restore saved state (selected products and conversation) if present
const restoredMessages = loadMessagesHistory();
const restoredSelections = loadSelectedProducts();
if (restoredSelections) {
  // reflect saved selections in UI (cards will be highlighted when products are displayed)
  renderSelectedProducts();
}
if (restoredMessages) {
  // render conversation from saved history
  renderConversationFromHistory();
} else {
  appendChatMessage("assistant", startupWelcome);
  messagesHistory.push({ role: "assistant", content: startupWelcome });
  saveMessagesHistory();
}

/* Render the conversation from messagesHistory into the chat window (skips system messages) */
function renderConversationFromHistory() {
  chatWindow.innerHTML = "";
  // helper: escape regex for product name matching
  function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // helper: highlight selected product mentions inside assistant text
  function highlightProductMentionsInText(text) {
    if (!text) return "";
    let t = text;
    const tokens = [];
    selectedProducts.forEach((p, i) => {
      const name = (p && p.name) || "";
      if (!name) return;
      const token = `@@PRODUCT_${i}@@`;
      tokens.push({ token, name });
      const re = new RegExp(escapeRegExp(name), "gi");
      t = t.replace(re, token);
    });

    let html = renderMarkdownToHTML(t);
    tokens.forEach(({ token, name }) => {
      const safeName = escapeHtml(name);
      const replacement = `<span class="product-ref">${safeName}</span>`;
      html = html.split(token).join(replacement);
    });
    return html;
  }
  for (const m of messagesHistory) {
    if (!m || !m.role) continue;
    // skip system messages and any internal instructions that should not be visible
    if (m.role === "system") continue;
    if (m.role === "user" && isInternalInstruction(m.content)) continue;
    if (m.role === "user") {
      appendChatMessage("user", m.content);
    } else if (m.role === "assistant") {
      // render assistant markdown as HTML and highlight any product mentions
      const wrapper = document.createElement("div");
      wrapper.className = "chat-message chat-assistant";
      wrapper.innerHTML = highlightProductMentionsInText(m.content);
      chatWindow.appendChild(wrapper);
    }
  }
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Render the selected products list UI */
function renderSelectedProducts() {
  selectedProductsListEl.innerHTML = selectedProducts
    .map(
      (p, i) => `
      <div class="selected-chip" data-sel-index="${i}">
        <span class="chip-name">${p.name}</span>
        <button class="chip-remove" aria-label="Remove ${p.name}">&times;</button>
      </div>
    `
    )
    .join("");

  // If there are any selected products, show a Clear All button for convenience
  if (selectedProducts.length > 0) {
    const clearBtn = document.createElement("button");
    clearBtn.className = "clear-all";
    clearBtn.id = "clearAllSelections";
    clearBtn.type = "button";
    clearBtn.textContent = "Clear all";
    clearBtn.setAttribute("aria-label", "Clear all selected products");
    selectedProductsListEl.appendChild(clearBtn);
  }
  // persist selections
  saveSelectedProducts();
}

/* Toggle selection for a product at given displayed index */
function toggleSelectByIndex(displayIndex) {
  const product = lastDisplayedProducts[displayIndex];
  if (!product) return;

  // check if already selected
  const existingIndex = selectedProducts.findIndex(
    (p) =>
      (p.id === product.id && p.id !== undefined) || p.name === product.name
  );
  const cardEl = productsContainer.querySelector(
    `.product-card[data-index="${displayIndex}"]`
  );

  if (existingIndex >= 0) {
    // unselect
    selectedProducts.splice(existingIndex, 1);
    if (cardEl) {
      cardEl.classList.remove("selected");
      cardEl.setAttribute("aria-pressed", "false");
    }
  } else {
    // select
    selectedProducts.push(product);
    if (cardEl) {
      cardEl.classList.add("selected");
      cardEl.setAttribute("aria-pressed", "true");
    }
  }

  // blur the card so focus-based hover state doesn't keep the description visible
  if (cardEl && typeof cardEl.blur === "function") cardEl.blur();

  renderSelectedProducts();
}

/* Click delegation: handle clicks on product cards */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  const idx = card.dataset.index;
  if (typeof idx === "undefined") return;
  toggleSelectByIndex(Number(idx));
});

/* Keyboard accessibility: allow Enter/Space to toggle selection */
productsContainer.addEventListener("keydown", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleSelectByIndex(Number(card.dataset.index));
  }
});

/* Allow removing from the selected list */
selectedProductsListEl.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".chip-remove");
  if (!removeBtn) return;
  const chip = removeBtn.closest(".selected-chip");
  const selIndex = Number(chip.dataset.selIndex);
  const prod = selectedProducts[selIndex];
  if (!prod) return;

  // remove from selectedProducts
  selectedProducts.splice(selIndex, 1);
  renderSelectedProducts();

  // also un-highlight card if visible
  const idx = lastDisplayedProducts.findIndex(
    (lp) => lp.id === prod.id || lp.name === prod.name
  );
  if (idx >= 0) {
    const el = productsContainer.querySelector(
      `.product-card[data-index="${idx}"]`
    );
    if (el) {
      el.classList.remove("selected");
      el.setAttribute("aria-pressed", "false");
    }
  }
});

/* Clear all selections handler (uses in-page confirm UI) */
selectedProductsListEl.addEventListener("click", (e) => {
  const clearBtn =
    e.target.closest(".clear-all") || e.target.closest("#clearAllSelections");
  if (!clearBtn) return;

  // show an in-page confirmation UI instead of the native confirm()
  showClearAllConfirm(clearBtn);
});

/* Create and show an in-page confirmation UI to clear all selections */
function showClearAllConfirm(anchorEl) {
  // If an existing confirm box is present, don't create another
  if (document.querySelector(".clear-confirm")) return;

  const confirmBox = document.createElement("div");
  confirmBox.className = "clear-confirm";
  confirmBox.setAttribute("role", "dialog");
  confirmBox.setAttribute("aria-modal", "true");
  confirmBox.innerHTML = `
    <div class="clear-confirm-inner">
      <p class="clear-confirm-message">Remove all selected products?</p>
      <div class="clear-confirm-actions">
        <button class="btn btn-confirm" type="button">Confirm</button>
        <button class="btn btn-cancel" type="button">Cancel</button>
      </div>
    </div>
  `;

  // Insert the confirm box into the selected products container so it's visually connected
  selectedProductsListEl.appendChild(confirmBox);

  const btnConfirm = confirmBox.querySelector(".btn-confirm");
  const btnCancel = confirmBox.querySelector(".btn-cancel");

  function doClear() {
    // un-highlight any visible cards
    selectedProducts.forEach((prod) => {
      const idx = lastDisplayedProducts.findIndex(
        (lp) => lp.id === prod.id || lp.name === prod.name
      );
      if (idx >= 0) {
        const el = productsContainer.querySelector(
          `.product-card[data-index="${idx}"]`
        );
        if (el) {
          el.classList.remove("selected");
          el.setAttribute("aria-pressed", "false");
        }
      }
    });

    // clear selection state and re-render
    selectedProducts = [];
    renderSelectedProducts();
    removeConfirm();
  }

  function removeConfirm() {
    // tidy up
    if (confirmBox && confirmBox.parentNode)
      confirmBox.parentNode.removeChild(confirmBox);
    // return focus to the Clear All button or the selectedProductsListEl
    if (anchorEl && typeof anchorEl.focus === "function") anchorEl.focus();
    else selectedProductsListEl.focus();
  }

  btnConfirm.addEventListener("click", doClear, { once: true });
  btnCancel.addEventListener("click", removeConfirm, { once: true });

  // keyboard handling: Esc cancels
  confirmBox.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") removeConfirm();
  });

  // focus the cancel button by default so users don't accidentally confirm
  btnCancel.focus();
}

/* Minimal markdown renderer for headings, bold and bullets */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdownToHTML(md) {
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  let out = "";
  let inList = false;

  for (let raw of lines) {
    let line = raw.trim();
    if (line === "") {
      if (inList) {
        out += "</ul>";
        inList = false;
      }
      out += "<br/>";
      continue;
    }

    // headings
    if (/^#{1,6}\s+/.test(line)) {
      if (inList) {
        out += "</ul>";
        inList = false;
      }
      const level = Math.min(6, line.match(/^#+/)[0].length);
      const text = escapeHtml(line.replace(/^#{1,6}\s+/, ""));
      out += `<h${level}>${text}</h${level}>`;
      continue;
    }

    // unordered list items
    if (/^[-*]\s+/.test(line)) {
      const item = escapeHtml(line.replace(/^[-*]\s+/, "")).replace(
        /\*\*(.*?)\*\*/g,
        "<strong>$1</strong>"
      );
      if (!inList) {
        inList = true;
        out += "<ul>";
      }
      out += `<li>${item}</li>`;
      continue;
    }

    // paragraph (also support bold **text**)
    const paragraph = escapeHtml(line).replace(
      /\*\*(.*?)\*\*/g,
      "<strong>$1</strong>"
    );
    out += `<p>${paragraph}</p>`;
  }

  if (inList) out += "</ul>";
  return out;
}

/* Generate Routine button: collect selected products, send to Worker, display formatted response */
const generateBtn = document.getElementById("generateRoutine");
if (generateBtn) {
  generateBtn.addEventListener("click", async () => {
    if (!selectedProducts || selectedProducts.length === 0) {
      appendChatMessage(
        "assistant",
        "Please select at least one product before generating a routine."
      );
      return;
    }

    // show loading assistant message
    const loadingEl = appendChatMessage("assistant", "Generating routine...");

    try {
      // Prepare system and user messages. The system prompt instructs formatting rules.
      const systemPrompt = `You are an expert skincare and beauty routine creator. Given a list of products and their details, produce a clear step-by-step routine tailored to these items. Format the response using Markdown: include a short title, bold important steps or notes, and use bullet points for step lists. Keep it concise and actionable.`;

      const userPayload = {
        products: selectedProducts.map((p) => ({
          name: p.name,
          brand: p.brand,
          category: p.category,
          description: p.description || "",
        })),
      };

      // Create a strong, per-request instruction that forces inclusion of all provided products
      // and instructs the model to avoid repeating product descriptions or brand overviews
      // (those are available in Info Mode). The assistant should produce a concise,
      // step-by-step routine using the provided items and include only short actionable tips
      // when necessary. We do NOT push this into the persistent messagesHistory until after a
      // successful response, to avoid the global system prompt being misinterpreted later.
      const genInstruction =
        "Please generate a concise, step-by-step routine using the following products. Do NOT include full product descriptions or brand overviews (those are shown in Info Mode). Focus only on ordered application steps, timing (morning/evening), frequency where relevant, and brief actionable tips (one or two short sentences per step). Format the response in Markdown (title, numbered steps, bold for important notes, and bullets for tips):\n" +
        JSON.stringify(userPayload, null, 2);

      // Clarify that all listed products must be included in the routine. Do not refuse to include
      // any product simply because its brand field doesn't say 'L'Oréal'. If a product's brand is
      // explicitly a non-L'Oréal brand, you may briefly note that but still include it as requested.
      const inclusionClarification =
        "IMPORTANT: For this request, include every product listed below in the routine. Do not omit items or refuse to include them because of brand name heuristics. Keep notes short; do not repeat full product descriptions.";

      // Build a temporary payload that includes the current conversation plus the per-request clarifications.
      const payloadMessages = [
        ...messagesHistory,
        { role: "user", content: inclusionClarification },
        { role: "user", content: genInstruction },
      ];

      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        loadingEl.querySelector(
          "p"
        ).textContent = `Error: ${res.status} ${txt}`;
        return;
      }

      const data = await res.json();
      let assistantReply =
        data?.choices?.[0]?.message?.content ||
        data?.reply ||
        data?.message ||
        JSON.stringify(data);

      // Save the generation instruction and raw assistant reply into history for future follow-ups
      const rawAssistant = assistantReply;
      messagesHistory.push({ role: "user", content: genInstruction });
      messagesHistory.push({ role: "assistant", content: rawAssistant });
      // persist conversation
      saveMessagesHistory();
      // mark that a routine was generated so follow-up questions about it are allowed
      routineGenerated = true;

      // Highlight selected product mentions by tokenizing product names first,
      // render markdown to HTML, then replace tokens with highlighted HTML.
      function escapeRegExp(string) {
        return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      const tokens = [];
      selectedProducts.forEach((p, i) => {
        const name = p.name || "";
        if (!name) return;
        const token = `@@PRODUCT_${i}@@`;
        tokens.push({ token, name });
        const re = new RegExp(escapeRegExp(name), "gi");
        assistantReply = assistantReply.replace(re, token);
      });

      // render markdown into HTML for the chat window
      let html = renderMarkdownToHTML(assistantReply);

      // Replace tokens with safe HTML that highlights product refs
      tokens.forEach(({ token, name }) => {
        const safeName = escapeHtml(name);
        const replacement = `<span class="product-ref">${safeName}</span>`;
        html = html.split(token).join(replacement);
      });

      // replace loading message with formatted assistant response
      loadingEl.innerHTML = html;
      chatWindow.scrollTop = chatWindow.scrollHeight;
    } catch (err) {
      console.error("Generate routine failed", err);
      loadingEl.querySelector("p").textContent =
        "Sorry — could not generate routine. Try again later.";
    }
  });
}

/* Chat form submission handler - sends user message to the Cloudflare Worker and shows the assistant reply */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const inputEl = document.getElementById("userInput");
  const userText = inputEl.value.trim();
  if (!userText) return;

  // show user's message
  appendChatMessage("user", userText);
  inputEl.value = "";
  // Local friendly handling for simple greetings / name intros (no API call needed)
  if (isNameIntro(userText)) {
    const name = parseNameFromIntro(userText) || "";
    const reply = name
      ? `Nice to meet you, ${name}! I'm here to help you build a L'Oréal routine — select products and click "Generate Routine" or ask about L'Oréal products.`
      : "Nice to meet you! I'm here to help you build a L'Oréal routine — select products and click \"Generate Routine\" or ask about L'Oréal products.";
    const loadingEl = appendChatMessage("assistant", reply);
    messagesHistory.push({ role: "user", content: userText });
    messagesHistory.push({ role: "assistant", content: reply });
    saveMessagesHistory();
    return;
  }

  if (isGreeting(userText)) {
    const reply =
      "Hi — welcome! I can help you build a personalized routine with L'Oréal products. Select some products and click \"Generate Routine\", or ask me about L'Oréal skincare, haircare, makeup, or fragrance.";
    const loadingEl = appendChatMessage("assistant", reply);
    messagesHistory.push({ role: "user", content: userText });
    messagesHistory.push({ role: "assistant", content: reply });
    saveMessagesHistory();
    return;
  }

  // show assistant loading message
  const loadingEl = appendChatMessage("assistant", "Thinking...");

  // Quick client-side out-of-scope check: decline if not allowed
  if (!isAllowedQuestion(userText)) {
    const decline =
      "Sorry — I can only answer questions about L'Oréal products, routines, or closely related topics. I can't help with other brands or unrelated subjects.";
    // update the loading bubble with a polite decline
    loadingEl.querySelector("p").textContent = decline;
    // record assistant decline in history
    messagesHistory.push({ role: "assistant", content: decline });
    saveMessagesHistory();
    return;
  }

  try {
    // add the user's message to conversation history
    messagesHistory.push({ role: "user", content: userText });
    saveMessagesHistory();

    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messagesHistory }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      loadingEl.querySelector("p").textContent = `Error: ${res.status} ${txt}`;
      return;
    }

    const data = await res.json();
    const assistantReply =
      data?.choices?.[0]?.message?.content ||
      data?.reply ||
      data?.message ||
      JSON.stringify(data);

    // push assistant reply into history so follow-ups have context
    messagesHistory.push({ role: "assistant", content: assistantReply });
    saveMessagesHistory();

    // render assistant reply (support markdown) into the chat window
    const rendered = renderMarkdownToHTML(assistantReply);
    loadingEl.innerHTML = rendered;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  } catch (err) {
    console.error("Chat request failed", err);
    loadingEl.querySelector("p").textContent =
      "Sorry — I could not reach the API. Try again later.";
  }
});
