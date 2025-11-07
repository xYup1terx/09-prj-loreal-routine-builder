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
const messagesHistory = [
  {
    role: "system",
    content:
      "You are an assistant that ONLY answers questions about L'Oréal products, routines, and closely related topics (skincare, haircare, makeup, fragrance). However, when the user provides a list of products (for example when generating a routine), assume the provided product entries are to be considered for the routine unless the product's brand field explicitly indicates a non-L'Oréal brand. Do NOT omit or exclude products from the routine simply because their name does not contain the word 'L'Oréal'. If a user asks about another brand or an unrelated topic, politely decline. Use the conversation history to provide relevant, concise answers about the generated routine or L'Oréal products.",
  },
];

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

  // deny if explicitly asks about other brands we know (to be conservative)
  for (const b of OUT_OF_SCOPE_BRANDS) if (t.includes(b)) return false;

  // allow if mentions L'Oreal explicitly
  if (t.includes("l'oreal") || t.includes("loreal")) return true;

  // allow follow-ups if a routine has already been generated in this session (unless it mentions a banned brand)
  if (routineGenerated) return true;

  // allow if it mentions core topics
  const allowedTerms = [
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
  ];
  for (const term of allowedTerms) if (t.includes(term)) return true;

  // allow if it references any selected product by name
  for (const p of selectedProducts) {
    if (!p || !p.name) continue;
    if (t.includes(p.name.toLowerCase())) return true;
  }

  // conservative default: deny (require explicit L'Oréal or product/topic mention)
  return false;
}

/* State for product selection */
const selectedProductsListEl = document.getElementById("selectedProductsList");
let selectedProducts = []; // array of product objects selected by the user
let lastDisplayedProducts = [];
// flag set when a routine has been generated during this session
let routineGenerated = false;

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

      // Add a user instruction into the conversation history for generation
      const genInstruction =
        "Please generate a routine using the following products. Format the response in Markdown (headers, bold, bullets):\n" +
        JSON.stringify(userPayload, null, 2);
      messagesHistory.push({ role: "user", content: genInstruction });

      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesHistory }),
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

      // Save raw assistant reply into history for future follow-ups
      const rawAssistant = assistantReply;
      messagesHistory.push({ role: "assistant", content: rawAssistant });
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
    return;
  }

  try {
    // add the user's message to conversation history
    messagesHistory.push({ role: "user", content: userText });

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
