/**
 * Tiny DOM helpers shared by the features.
 * @module core/dom
 */

/** @param {string} selector @param {ParentNode} [root] */
export function $(selector, root = document) {
  return root.querySelector(selector);
}

/** @param {string} selector @param {ParentNode} [root] */
export function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Create an element.
 *
 * Supported props: `class`, `text`, `html` (trusted markup only), `dataset`,
 * `on<Event>` listeners, booleans (set/remove attribute) and plain attributes.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {...(Node|string|null|undefined|Array<Node|string|null|undefined>)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/** Remove every child of a node. @param {Element} node */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Debounce a function.
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} [delay]
 * @returns {(...args: Parameters<T>) => void}
 */
export function debounce(fn, delay = 200) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}
