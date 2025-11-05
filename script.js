/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

/* Cloudflare Worker base URL - your provided endpoint */
const API_BASE = "https://loreallll.templeal.workers.dev";

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
  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
      </div>
    </div>
  `
    )
    .join("");
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
