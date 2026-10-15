// A fake footer for src/ui/contact.js in a node:vm sandbox: the Contact button,
// the links paragraph with the email and LinkedIn, and the document and window
// listeners the module binds. It starts as index.html does: the button hidden
// and expanded, the links showing.

function createListeners() {
  const registrations = new Map();
  return {
    add(type, callback, options) {
      registrations.set(type, [...(registrations.get(type) || []), { callback, options }]);
    },
    count(type) {
      return (registrations.get(type) || []).length;
    },
    fire(type, event = {}) {
      for (const registration of [...(registrations.get(type) || [])]) {
        if (registration.options?.once) {
          registrations.set(
            type,
            registrations.get(type).filter((item) => item !== registration),
          );
        }
        registration.callback({ type, ...event });
      }
    },
  };
}

export function createContactDom({
  readyState = "complete",
  hash = "",
  toggle: withToggle = true,
  links: withLinks = true,
} = {}) {
  const document = { readyState, activeElement: null };

  function element(name, { hidden = false, attributes = {}, children = [] } = {}) {
    const listeners = createListeners();
    const values = new Map(Object.entries(attributes));
    return {
      name,
      hidden,
      children,
      focusOptions: null,
      getAttribute: (key) => (values.has(key) ? values.get(key) : null),
      setAttribute: (key, value) => values.set(key, String(value)),
      addEventListener: listeners.add,
      listenerCount: listeners.count,
      dispatch: listeners.fire,
      contains(target) {
        return target === this || this.children.some((child) => child.contains(target));
      },
      focus(options) {
        this.focusOptions = options;
        document.activeElement = this;
      },
    };
  }

  const body = element("body");
  const toggle = element("Contact", { hidden: true, attributes: { "aria-expanded": "true" } });
  const email = element("email");
  const linkedin = element("LinkedIn");
  const links = element("links", { children: [email, linkedin] });
  const documentListeners = createListeners();
  const windowListeners = createListeners();

  Object.assign(document, {
    body,
    activeElement: body,
    querySelector: (selector) =>
      selector === ".site-footer__contact" && withToggle ? toggle : null,
    querySelectorAll: () => [],
    getElementById: (id) => (id === "contact-links" && withLinks ? links : null),
    addEventListener: documentListeners.add,
    listenerCount: documentListeners.count,
    dispatch: documentListeners.fire,
  });
  const window = {
    BabelSite: { ui: {} },
    location: { hash, search: "" },
    addEventListener: windowListeners.add,
    listenerCount: windowListeners.count,
    dispatch: windowListeners.fire,
  };
  return { document, window, toggle, links, email, linkedin };
}
