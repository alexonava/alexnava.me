(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const ui = (site.ui = site.ui || {});
  const BACKGROUND_SELECTORS = [
    ".skip-link",
    ".scene-shell",
    ".site-shell",
    "main",
    ".bottom-bar",
    ".site-footer",
  ];
  const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  function focusElement(element) {
    if (!element) return;

    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  // Reports the dialog now showing, or none, for URL and scene listeners.
  function announce(id) {
    if (typeof window.CustomEvent !== "function") return;
    document.dispatchEvent(
      new window.CustomEvent("babel:panelchange", { detail: { id, open: id !== null } }),
    );
  }

  let initialized = false;

  ui.initPanels = function initPanels() {
    if (initialized) return true;
    const buttons = Array.from(document.querySelectorAll(".bottom-btn[data-panel]"));
    const panels = Array.from(document.querySelectorAll(".panel-overlay"));
    if (!buttons.length || !panels.length) return false;
    if (
      buttons.some(
        (button) => !panels.includes(document.getElementById(`panel-${button.dataset.panel}`)),
      ) ||
      panels.some((panel) => !getPanelCard(panel) || !panel.querySelector(".panel-close"))
    )
      return false;

    const reduceMotion = site.shared.reducedMotionQuery();
    const backgroundNodes = BACKGROUND_SELECTORS.map((selector) =>
      document.querySelector(selector),
    ).filter(Boolean);

    let restoreFocusTarget = null;
    let activePanel = null;
    const pendingHides = new Map();
    const panelHistory = [];

    function cancelHide(panel) {
      pendingHides.get(panel)?.cancel();
    }

    function setExpandedState(activePanelId = null) {
      buttons.forEach((button) => {
        button.setAttribute(
          "aria-expanded",
          button.dataset.panel === activePanelId ||
            panelHistory.some((entry) => entry.panel.id === `panel-${button.dataset.panel}`)
            ? "true"
            : "false",
        );
      });
    }

    function setBackgroundInert(isInert) {
      backgroundNodes.forEach((node) => {
        node.inert = isInert;
      });

      if (isInert) {
        document.body.setAttribute("data-panel-open", "true");
        return;
      }

      document.body.removeAttribute("data-panel-open");
    }

    function getPanelCard(panel) {
      return panel.querySelector(".panel-surface, .panel-card");
    }

    function getFocusableElements(panel) {
      return Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && !element.inert,
      );
    }

    function hidePanel(panel) {
      if (!panel || panel.hidden) return;

      panel.setAttribute("aria-hidden", "true");
      panel.inert = true;
      panel.classList.remove("open");

      cancelHide(panel);
      if (reduceMotion?.matches) {
        panel.hidden = true;
        return;
      }

      // Every closing cycle owns its callbacks; reopening cancels that cycle.
      const cycle = {};
      const finishHide = () => {
        if (pendingHides.get(panel) !== cycle) return;
        cycle.cancel();
        if (!panel.classList.contains("open")) panel.hidden = true;
      };
      const onTransitionEnd = (event) => {
        if (event.target !== panel || (event.propertyName && event.propertyName !== "opacity"))
          return;
        finishHide();
      };
      cycle.cancel = () => {
        window.clearTimeout(cycle.timer);
        panel.removeEventListener("transitionend", onTransitionEnd);
        pendingHides.delete(panel);
      };
      cycle.finish = finishHide;
      pendingHides.set(panel, cycle);
      panel.addEventListener("transitionend", onTransitionEnd);
      cycle.timer = window.setTimeout(finishHide, 320);
    }

    function focusPanel(panel) {
      const card = getPanelCard(panel);
      const closeButton = panel.querySelector(".panel-close");
      const focusable = getFocusableElements(panel);
      focusElement(closeButton || focusable[0] || card);
    }

    function closePanel({ restoreFocus = true } = {}) {
      if (restoreFocus && panelHistory.length) {
        const entry = panelHistory.pop();
        const parentId = entry.panel.id.replace("panel-", "");
        openPanel(parentId, entry.rootTrigger, false);
        focusElement(entry.childTrigger);
        announce(parentId);
        return;
      }
      if (activePanel) {
        hidePanel(activePanel);
        activePanel = null;
      }

      setExpandedState();
      setBackgroundInert(false);

      if (restoreFocus && restoreFocusTarget) {
        focusElement(restoreFocusTarget);
      }

      if (restoreFocus) {
        restoreFocusTarget = null;
        announce(null);
      }
    }

    function openPanel(panelId, trigger, announceChange = true) {
      const panel = document.getElementById(`panel-${panelId}`);
      if (!panel) return;

      const parent = activePanel && activePanel.contains(trigger) ? activePanel : null;
      if (parent)
        panelHistory.push({
          panel: parent,
          rootTrigger: restoreFocusTarget,
          childTrigger: trigger,
        });
      closePanel({ restoreFocus: false });
      restoreFocusTarget = trigger;
      activePanel = panel;
      cancelHide(panel);
      panel.hidden = false;
      panel.inert = false;
      panel.removeAttribute("aria-hidden");
      panel.offsetWidth;
      panel.classList.add("open");
      setExpandedState(panelId);
      setBackgroundInert(true);
      focusPanel(panel);
      if (announceChange) announce(panelId);
    }

    function trapFocus(event) {
      if (!activePanel || event.key !== "Tab") return;

      const focusable = getFocusableElements(activePanel);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey) {
        if (current === first || !activePanel.contains(current)) {
          event.preventDefault();
          focusElement(last);
        }
        return;
      }

      if (current === last || !activePanel.contains(current)) {
        event.preventDefault();
        focusElement(first);
      }
    }

    const removers = [];
    function listen(target, type, handler) {
      target.addEventListener(type, handler);
      removers.push(() => target.removeEventListener(type, handler));
    }
    try {
      if (reduceMotion?.addEventListener) {
        listen(reduceMotion, "change", () => {
          if (reduceMotion.matches) {
            for (const cycle of pendingHides.values()) cycle.finish();
          }
        });
      }
      buttons.forEach((button) => {
        listen(button, "click", () => {
          const panelId = button.dataset.panel;
          if (!panelId) return;

          if (button.getAttribute("aria-expanded") === "true") {
            closePanel();
            return;
          }

          openPanel(panelId, button);
        });
      });

      document.querySelectorAll(".panel-close").forEach((button) => {
        listen(button, "click", () => closePanel());
      });

      panels.forEach((panel) => {
        // A drag-select between the paper and the backdrop clicks their common
        // ancestor, so only a press and release both on the backdrop dismiss.
        let pressedBackdrop = false;
        listen(panel, "pointerdown", (event) => {
          pressedBackdrop = event.target === panel;
        });
        listen(panel, "pointerup", (event) => {
          if (event.target !== panel) pressedBackdrop = false;
        });
        listen(panel, "click", (event) => {
          const dismiss = pressedBackdrop && event.target === panel;
          pressedBackdrop = false;
          if (dismiss) closePanel();
        });
      });

      listen(document, "keydown", (event) => {
        if (event.key === "Escape") {
          if (activePanel) {
            closePanel();
          }
          return;
        }

        trapFocus(event);
      });
      initialized = true;
      return true;
    } catch {
      // A retry must never inherit a half-bound controller.
      removers.reverse().forEach((remove) => remove());
      return false;
    }
  };
})();
