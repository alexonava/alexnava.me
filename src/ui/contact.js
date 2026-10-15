(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const ui = (site.ui = site.ui || {});
  // Addresses naming About, its sections or Contact open Contact.
  const OPENING_HASH = /^#(about|profile|experience|contact)(-text)?$/;

  let initialized = false;

  // The footer's Contact discloses the email and LinkedIn beside it. Without
  // scripts the button stays hidden and the links show on their own.
  ui.initContact = function initContact() {
    if (initialized) return true;
    const toggle = document.querySelector(".site-footer__contact");
    const links = document.getElementById("contact-links");
    if (!toggle || !links) return false;
    // Never hide a link a visitor already has focus on.
    if (links.contains(document.activeElement)) return false;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      links.hidden = !open;
    }

    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || links.hidden) return;
      const hadFocus = links.contains(document.activeElement);
      setOpen(false);
      if (hadFocus) toggle.focus({ preventScroll: true });
    });
    const followHash = () => {
      if (OPENING_HASH.test(window.location.hash)) setOpen(true);
    };
    window.addEventListener("hashchange", followHash);

    setOpen(false);
    toggle.hidden = false;
    followHash();
    initialized = true;
    return true;
  };
})();
