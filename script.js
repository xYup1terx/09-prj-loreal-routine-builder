/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

/* Cloudflare Worker base URL - your provided endpoint */
const API_BASE = "https://loreallll.templeal.workers.dev";

/* State for product selection */
const selectedProductsListEl = document.getElementById("selectedProductsList");
let selectedProducts = []; // array of product objects selected by the user
let lastDisplayedProducts = [];

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

  try {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: userText }] }),
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
    loadingEl.querySelector("p").textContent = assistantReply;
  } catch (err) {
    console.error("Chat request failed", err);
    loadingEl.querySelector("p").textContent =
      "Sorry — I could not reach the API. Try again later.";
  }
});
