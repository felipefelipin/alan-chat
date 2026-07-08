// utils/dom.js
// Helpers pequenos de DOM — sem dependências, sem framework.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "mi";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + "mil";
  return String(n);
}

// dispara callback quando o elemento entra na viewport — usado pro lazy load do grid
export function onVisible(target, callback, opts = {}) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        callback();
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: "200px", ...opts });
  io.observe(target);
  return io;
}
