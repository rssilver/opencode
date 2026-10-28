// Scripts run in an isolated world of the page (no access to page globals). They only
// read the DOM, stamp elements with `data-oc-idx` and click/type/scroll; callers cannot
// supply code, only JSON-encoded data that is embedded as literals.

export const ELEMENT_ATTRIBUTE = "data-oc-idx"
export const MAX_ELEMENTS = 150

export type Target = { index: number } | { selector: string }

export type PageElement = { index: number; tag: string; label: string; href?: string; type?: string; value?: string }
export type PageSnapshot = {
  url: string
  title: string
  text: string
  truncated: boolean
  elements: PageElement[]
}
export type ActionResult = { ok: boolean; message: string }

/** Reads `index` or `selector` from tool arguments; index wins when both are present. */
export function parseTarget(args: Record<string, unknown>): Target | undefined {
  if (typeof args.index === "number" && Number.isInteger(args.index) && args.index >= 0) return { index: args.index }
  if (typeof args.selector === "string" && args.selector.trim()) return { selector: args.selector.trim() }
  return undefined
}

export function readScript(maxChars: number) {
  return `(() => {
  const MAX_CHARS = ${JSON.stringify(Math.max(0, Math.floor(maxChars)))};
  const MAX_ELEMENTS = ${MAX_ELEMENTS};
  document.querySelectorAll('[${ELEMENT_ATTRIBUTE}]').forEach((el) => el.removeAttribute('${ELEMENT_ATTRIBUTE}'));
  const selector = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=menuitem],[role=switch],[onclick],[contenteditable=""],[contenteditable="true"]';
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = (el) => clean(
    el.getAttribute('aria-label') ||
    (el.labels && el.labels[0] && el.labels[0].innerText) ||
    el.innerText ||
    (el.type !== 'password' && el.value) ||
    el.placeholder ||
    el.title ||
    el.getAttribute('alt') ||
    el.name
  );
  const elements = [];
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (!visible(el)) continue;
    const index = elements.length;
    el.setAttribute('${ELEMENT_ATTRIBUTE}', String(index));
    const tag = el.tagName.toLowerCase();
    const item = { index, tag, label: label(el) };
    if (el.href) item.href = String(el.href).slice(0, 200);
    if (tag === 'input' || tag === 'button') item.type = el.type;
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.type !== 'password' && el.value && tag !== 'button')
      item.value = clean(el.value);
    elements.push(item);
  }
  const full = document.body ? document.body.innerText : '';
  return {
    url: location.href,
    title: document.title,
    text: full.slice(0, MAX_CHARS),
    truncated: full.length > MAX_CHARS,
    elements,
  };
})()`
}

export function clickScript(target: Target) {
  return `(() => {
  ${resolveElement(target)}
  if (!el) return { ok: false, message: 'Element not found. Run browser_read again to refresh the element list.' };
  if (el.disabled) return { ok: false, message: 'Element is disabled.' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  if (typeof el.focus === 'function') el.focus();
  el.click();
  return { ok: true, message: 'Clicked ' + describe(el) + '.' };
})()`
}

export function typeScript(target: Target, text: string, submit: boolean) {
  return `(() => {
  ${resolveElement(target)}
  const text = ${JSON.stringify(text)};
  const submit = ${JSON.stringify(submit)};
  if (!el) return { ok: false, message: 'Element not found. Run browser_read again to refresh the element list.' };
  if (el.disabled || el.readOnly) return { ok: false, message: 'Element is disabled or read-only.' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus();
  const tag = el.tagName.toLowerCase();
  const fire = (name) => el.dispatchEvent(new Event(name, { bubbles: true }));
  if (tag === 'select') {
    const option = Array.from(el.options).find((o) => o.value === text || o.text.trim() === text);
    if (!option) return { ok: false, message: 'No option matching "' + text + '".' };
    el.value = option.value;
    fire('input');
    fire('change');
  } else if (tag === 'input' || tag === 'textarea') {
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'button' || el.type === 'submit' || el.type === 'file')
      return { ok: false, message: 'Cannot type into a ' + el.type + ' input; use browser_click.' };
    const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    fire('input');
    fire('change');
  } else if (el.isContentEditable) {
    el.textContent = text;
    fire('input');
  } else {
    return { ok: false, message: 'Element is not a text field.' };
  }
  if (submit) {
    if (el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
    else for (const type of ['keydown', 'keypress', 'keyup'])
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  return { ok: true, message: 'Typed into ' + describe(el) + (submit ? ' and submitted.' : '.') };
})()`
}

export type ScrollDirection = "up" | "down" | "top" | "bottom"

export function scrollScript(direction: ScrollDirection) {
  return `(() => {
  const direction = ${JSON.stringify(direction)};
  const root = document.scrollingElement || document.documentElement;
  const page = window.innerHeight * 0.8;
  if (direction === 'up') window.scrollBy(0, -page);
  else if (direction === 'down') window.scrollBy(0, page);
  else if (direction === 'top') window.scrollTo(0, 0);
  else window.scrollTo(0, root.scrollHeight);
  return { ok: true, message: 'Scrolled to ' + Math.round(window.scrollY) + 'px of ' + Math.max(0, root.scrollHeight - window.innerHeight) + 'px.' };
})()`
}

function resolveElement(target: Target) {
  const lookup =
    "index" in target
      ? `document.querySelector('[${ELEMENT_ATTRIBUTE}="' + ${JSON.stringify(String(target.index))} + '"]')`
      : `(() => { try { return document.querySelector(${JSON.stringify(target.selector)}); } catch { return null; } })()`
  return `const el = ${lookup};
  const describe = (node) => {
    const text = (node.getAttribute('aria-label') || node.innerText || node.value || node.placeholder || node.name || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    return '<' + node.tagName.toLowerCase() + '>' + (text ? ' "' + text + '"' : '');
  };`
}
