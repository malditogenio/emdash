(function () {
  if (window.__melonLoaded) return;
  window.__melonLoaded = true;

  var isLocal = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname) || location.hostname.endsWith(".local");
  var forced = new URLSearchParams(location.search).get("melon") === "1";
  if (!isLocal && !forced) return;

  var STORAGE_KEY = "melon:" + location.pathname;
  var comments = [];
  try {
    comments = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    comments = [];
  }

  var migrated = false;
  comments = comments.map(function (comment) {
    if (comment.pageX == null && comment.viewX != null) {
      comment.pageX = (comment.viewX / 100) * window.innerWidth;
      migrated = true;
    }
    if (comment.pageY == null && comment.viewY != null) {
      comment.pageY = (comment.viewY / 100) * window.innerHeight;
      migrated = true;
    }
    comment.offsetX ??= 0.5;
    comment.offsetY ??= 0.5;
    return comment;
  });

  var commentMode = false;
  var activeBubble = null;
  var renderTimer = null;
  var isRendering = false;

  var style = document.createElement("style");
  style.textContent = [
    ".melon-toolbar{position:fixed;top:12px;right:12px;z-index:2147483646;display:flex;gap:6px;align-items:center;background:#111;color:#fff;padding:6px 8px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25);font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:12px}",
    ".melon-toolbar .count{padding:0 6px;color:#bbb}",
    ".melon-toolbar button{padding:5px 9px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#fff;cursor:pointer;font-size:12px;font-family:inherit}",
    ".melon-toolbar button:hover{background:#242424}",
    ".melon-toolbar button.primary{background:#ff3366;border-color:#ff3366}",
    ".melon-toolbar button.primary:hover{background:#ff4d7a}",
    ".melon-toolbar button.on{background:#22c55e;border-color:#22c55e;color:#041}",
    "body.melon-active,body.melon-active *{cursor:crosshair!important}",
    "body.melon-active .melon-toolbar,body.melon-active .melon-toolbar *,body.melon-active .melon-pin,body.melon-active .melon-bubble,body.melon-active .melon-bubble *{cursor:auto!important}",
    ".melon-pin{position:absolute;width:26px;height:26px;background:#ff3366;color:#fff;border-radius:50%;border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,sans-serif;font-size:12px;font-weight:700;cursor:pointer;z-index:2147483645;transform:translate(-50%,-50%)}",
    ".melon-pin:hover{transform:translate(-50%,-50%) scale(1.15)}",
    ".melon-pin.stale{background:#94a3b8}",
    ".melon-bubble{position:fixed;width:300px;background:#fff;border:1px solid #e5e5e5;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.18);padding:12px;z-index:2147483647;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;color:#111}",
    ".melon-bubble textarea{width:100%;min-height:80px;border:1px solid #e5e5e5;border-radius:6px;padding:8px;font-family:inherit;font-size:13px;resize:vertical;box-sizing:border-box;color:#111;background:#fff}",
    ".melon-bubble textarea:focus{outline:2px solid #ff3366;border-color:#ff3366}",
    ".melon-bubble .actions{display:flex;gap:6px;margin-top:8px;justify-content:flex-end}",
    ".melon-bubble button{padding:5px 10px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#111;cursor:pointer;font-size:12px;font-family:inherit}",
    ".melon-bubble button:hover{background:#f5f5f5}",
    ".melon-bubble button.primary{background:#ff3366;color:#fff;border-color:#ff3366}",
    ".melon-bubble button.primary:hover{background:#ff4d7a}",
    ".melon-bubble button.danger{color:#b00020;border-color:#f4c2c2}"
  ].join("");
  document.head.appendChild(style);

  function getSelector(element) {
    if (!element || element.nodeType !== 1) return "";
    if (element.id) return "#" + CSS.escape(element.id);

    var path = [];
    var current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      var selector = current.tagName.toLowerCase();
      if (current.classList && current.classList.length) {
        var classSelector = Array.prototype.slice.call(current.classList)
          .filter(function (className) { return className.indexOf("melon-") !== 0; })
          .slice(0, 2)
          .map(function (className) { return "." + CSS.escape(className); })
          .join("");
        if (classSelector) selector += classSelector;
      }

      var parent = current.parentNode;
      if (parent) {
        var siblings = Array.prototype.slice.call(parent.children).filter(function (sibling) {
          return sibling.tagName === current.tagName;
        });
        if (siblings.length > 1) selector += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }

      path.unshift(selector);
      if (current.id || path.length > 6) break;
      current = parent;
    }

    return path.join(" > ");
  }

  function normalizeWhitespace(value) {
    var output = "";
    var inSpace = false;
    for (var index = 0; index < value.length; index++) {
      var character = value[index];
      var isSpace = character === " " || character === "\n" || character === "\t" || character === "\r" || character === "\f";
      if (isSpace) {
        if (!inSpace) output += " ";
        inSpace = true;
      } else {
        output += character;
        inSpace = false;
      }
    }
    return output.trim();
  }

  function resolveAnchor(comment) {
    if (comment.selector) {
      try {
        var element = document.querySelector(comment.selector);
        if (element && element.getClientRects && element.getClientRects().length) {
          var rect = element.getBoundingClientRect();
          var offsetX = comment.offsetX ?? 0.5;
          var offsetY = comment.offsetY ?? 0.5;
          return {
            pageX: rect.left + window.scrollX + rect.width * offsetX,
            pageY: rect.top + window.scrollY + rect.height * offsetY,
            stale: false
          };
        }
      } catch {
        // Invalid selector. Fall back to absolute coordinates.
      }
    }

    return {
      pageX: comment.pageX || 0,
      pageY: comment.pageY || 0,
      stale: Boolean(comment.selector)
    };
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
    render();
  }

  function render() {
    isRendering = true;
    document.querySelectorAll(".melon-pin").forEach(function (pin) { pin.remove(); });

    comments.forEach(function (comment, index) {
      var anchor = resolveAnchor(comment);
      var pin = document.createElement("div");
      pin.className = "melon-pin" + (anchor.stale ? " stale" : "");
      pin.style.left = anchor.pageX + "px";
      pin.style.top = anchor.pageY + "px";
      pin.textContent = String(index + 1);
      pin.title = (anchor.stale ? "[no se encontro el elemento original] " : "") + comment.text;
      pin.addEventListener("click", function (event) {
        event.stopPropagation();
        event.preventDefault();
        var rect = pin.getBoundingClientRect();
        openBubble(rect.left + rect.width / 2, rect.top + rect.height / 2, index, null);
      });
      document.body.appendChild(pin);
    });

    var count = document.querySelector(".melon-toolbar .count");
    if (count) count.textContent = comments.length + (comments.length === 1 ? " nota" : " notas");
    requestAnimationFrame(function () { isRendering = false; });
  }

  function closeBubble() {
    if (activeBubble) {
      activeBubble.remove();
      activeBubble = null;
    }
  }

  function openBubble(clientX, clientY, editIndex, target) {
    closeBubble();

    var bubble = document.createElement("div");
    bubble.className = "melon-bubble";
    var existing = editIndex != null ? comments[editIndex] : null;
    bubble.innerHTML = [
      '<textarea placeholder="Escribe tu comentario..."></textarea>',
      '<div class="actions">',
      existing ? '<button class="danger del">Borrar</button>' : "",
      '<button class="cancel">Cancelar</button>',
      '<button class="primary sv">Guardar</button>',
      "</div>"
    ].join("");

    var textarea = bubble.querySelector("textarea");
    if (existing) textarea.value = existing.text;

    bubble.style.left = Math.max(8, Math.min(clientX, window.innerWidth - 312)) + "px";
    bubble.style.top = Math.max(8, Math.min(clientY + 14, window.innerHeight - 200)) + "px";
    document.body.appendChild(bubble);
    activeBubble = bubble;
    setTimeout(function () { textarea.focus(); }, 0);

    bubble.addEventListener("click", function (event) { event.stopPropagation(); });
    bubble.addEventListener("mousedown", function (event) { event.stopPropagation(); });

    bubble.querySelector(".cancel").onclick = closeBubble;
    bubble.querySelector(".sv").onclick = function () {
      var text = textarea.value.trim();
      if (!text) return;

      if (existing) {
        comments[editIndex].text = text;
      } else {
        var pageX = clientX + window.scrollX;
        var pageY = clientY + window.scrollY;
        var offsetX = 0.5;
        var offsetY = 0.5;
        var selector = "";
        var nearbyText = "";
        var tag = "";

        if (target && target.nodeType === 1) {
          var rect = target.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            offsetX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            offsetY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
          }
          selector = getSelector(target);
          nearbyText = normalizeWhitespace(target.textContent || "").slice(0, 160);
          tag = target.tagName.toLowerCase();
        }

        comments.push({
          text: text,
          selector: selector,
          offsetX: offsetX,
          offsetY: offsetY,
          pageX: pageX,
          pageY: pageY,
          nearbyText: nearbyText,
          tag: tag,
          url: location.href,
          viewport: window.innerWidth + "x" + window.innerHeight,
          docHeight: document.documentElement.scrollHeight,
          timestamp: new Date().toISOString()
        });
      }

      save();
      closeBubble();
    };

    if (existing) {
      bubble.querySelector(".del").onclick = function () {
        comments.splice(editIndex, 1);
        save();
        closeBubble();
      };
    }

    textarea.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        bubble.querySelector(".sv").click();
      }
      if (event.key === "Escape") closeBubble();
    });
  }

  function toMarkdown() {
    if (!comments.length) return "";
    var lines = [];
    lines.push("# Melon feedback");
    lines.push("**URL:** " + location.href);
    lines.push("**Capturado:** " + new Date().toISOString());
    lines.push("**Viewport actual:** " + window.innerWidth + "x" + window.innerHeight);
    lines.push("");

    comments.forEach(function (comment, index) {
      var title = comment.text.split("\n")[0].slice(0, 70);
      lines.push("## " + (index + 1) + ". " + title);
      lines.push("- **Posicion absoluta:** pageX " + Math.round(comment.pageX) + "px, pageY " + Math.round(comment.pageY) + "px");
      if (comment.selector) lines.push("- **Selector:** `" + comment.selector + "`");
      if (comment.offsetX != null && comment.offsetY != null) {
        lines.push("- **Offset en el elemento:** " + (comment.offsetX * 100).toFixed(0) + "%, " + (comment.offsetY * 100).toFixed(0) + "%");
      }
      if (comment.tag) lines.push("- **Elemento:** `<" + comment.tag + ">`");
      if (comment.nearbyText) lines.push('- **Texto cerca:** "' + comment.nearbyText + '"');
      if (comment.viewport) lines.push("- **Viewport captura:** " + comment.viewport);
      lines.push("- **Comentario:**");
      comment.text.split("\n").forEach(function (line) { lines.push("  > " + line); });
      lines.push("");
    });

    return lines.join("\n");
  }

  function setMode(on) {
    commentMode = on;
    document.body.classList.toggle("melon-active", on);
    var button = document.querySelector(".melon-toolbar .mode");
    if (button) {
      button.textContent = on ? "Modo: ON" : "Modo: OFF";
      button.classList.toggle("on", on);
    }
  }

  var toolbar = document.createElement("div");
  toolbar.className = "melon-toolbar";
  toolbar.innerHTML = [
    '<button class="mode" title="Atajo: c">Modo: OFF</button>',
    '<span class="count">0 notas</span>',
    '<button class="clr">Limpiar</button>',
    '<button class="primary copy">Copiar para Claude</button>'
  ].join("");
  document.body.appendChild(toolbar);
  toolbar.addEventListener("click", function (event) { event.stopPropagation(); });

  toolbar.querySelector(".mode").onclick = function () { setMode(!commentMode); };
  toolbar.querySelector(".clr").onclick = function () {
    if (!comments.length) return;
    if (confirm("Borrar todas las notas de esta pagina?")) {
      comments = [];
      save();
    }
  };
  toolbar.querySelector(".copy").onclick = async function () {
    if (!comments.length) {
      alert("Sin notas todavia.");
      return;
    }

    var markdown = toMarkdown();
    try {
      await navigator.clipboard.writeText(markdown);
      var button = toolbar.querySelector(".copy");
      var previous = button.textContent;
      button.textContent = "Copiado";
      setTimeout(function () { button.textContent = previous; }, 1500);
    } catch {
      window.prompt("Copia el markdown de Melon:", markdown);
    }
  };

  document.addEventListener("click", function (event) {
    if (!commentMode) return;
    if (event.target.closest(".melon-pin, .melon-bubble, .melon-toolbar")) return;
    if (activeBubble) {
      closeBubble();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openBubble(event.clientX, event.clientY, null, event.target);
  }, true);

  document.addEventListener("keydown", function (event) {
    if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
    if (event.key === "c" && !event.metaKey && !event.ctrlKey && !event.altKey) setMode(!commentMode);
    if (event.key === "Escape" && activeBubble) closeBubble();
  });

  function scheduleRerender() {
    if (isRendering || renderTimer) return;
    renderTimer = requestAnimationFrame(function () {
      renderTimer = null;
      render();
    });
  }

  window.addEventListener("resize", scheduleRerender);
  window.addEventListener("load", scheduleRerender);

  try {
    var observer = new MutationObserver(function (mutations) {
      if (isRendering) return;
      var changedOutsideMelon = mutations.some(function (mutation) {
        var target = mutation.target;
        return !target.closest || !target.closest(".melon-toolbar, .melon-pin, .melon-bubble");
      });
      if (changedOutsideMelon) scheduleRerender();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  } catch {
    // MutationObserver is optional. Resize/load still keep pins usable.
  }

  if (migrated) save();
  else render();
})();
