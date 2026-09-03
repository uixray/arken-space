// Обновляем содержимое, сохраняя DOM и фокус неизменившихся элементов управления.
const key = (node) => {
  if (node.nodeType !== 1) return null;
  for (const name of [
    "data-call",
    "data-mage",
    "data-details",
    "data-answer",
    "data-choice",
  ])
    if (node.hasAttribute(name)) return `${name}:${node.getAttribute(name)}`;
  return null;
};

function reconcile(parent, incoming) {
  let current = parent.firstChild;
  for (const next of [...incoming.childNodes]) {
    const nextKey = key(next);
    if (nextKey && key(current ?? {}) !== nextKey) {
      const match = [...parent.childNodes].find(
        (node) => key(node) === nextKey,
      );
      if (match) parent.insertBefore(match, current);
      else parent.insertBefore(next.cloneNode(true), current);
      current = match ?? (current ? current.previousSibling : parent.lastChild);
    }
    if (!current) {
      parent.append(next.cloneNode(true));
      continue;
    }
    if (
      current.nodeType !== next.nodeType ||
      current.nodeName !== next.nodeName ||
      key(current) !== nextKey
    ) {
      const replacement = next.cloneNode(true);
      parent.replaceChild(replacement, current);
      current = replacement;
    } else if (current.nodeType === 1) {
      for (const attr of [...current.attributes])
        if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
      for (const attr of next.attributes)
        if (current.getAttribute(attr.name) !== attr.value)
          current.setAttribute(attr.name, attr.value);
      reconcile(current, next);
    } else if (current.nodeValue !== next.nodeValue)
      current.nodeValue = next.nodeValue;
    current = current.nextSibling;
  }
  while (current) {
    const next = current.nextSibling;
    current.remove();
    current = next;
  }
}

export function renderMarkup(element, html) {
  const focused = element.ownerDocument.activeElement;
  const template = element.ownerDocument.createElement("template");
  template.innerHTML = html;
  reconcile(element, template.content);
  // insertBefore в старых браузерах снимает фокус даже с сохранённого узла.
  if (
    element.contains(focused) &&
    element.ownerDocument.activeElement !== focused
  )
    focused.focus({ preventScroll: true });
}
