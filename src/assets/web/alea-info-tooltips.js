(function () {
  var selector = ".alea-info-tip[data-tip]";
  var activeTip = null;
  var bubble = document.createElement("div");

  bubble.className = "alea-info-tip-bubble";
  bubble.setAttribute("role", "tooltip");
  document.documentElement.classList.add("alea-js-info-tooltips");
  document.body.appendChild(bubble);

  function closestTip(target) {
    if (!target || !target.closest) return null;
    return target.closest(selector);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function positionBubble() {
    if (!activeTip) return;
    if (!document.documentElement.contains(activeTip)) {
      hideBubble();
      return;
    }

    var rect = activeTip.getBoundingClientRect();
    var margin = 12;
    var gap = 8;
    var maxWidth = Math.max(180, window.innerWidth - margin * 2);

    bubble.style.maxWidth = Math.min(280, maxWidth) + "px";
    bubble.style.left = "0px";
    bubble.style.top = "0px";

    var bubbleWidth = bubble.offsetWidth;
    var bubbleHeight = bubble.offsetHeight;
    var left = rect.left + rect.width / 2 - bubbleWidth / 2;
    var top = rect.top - bubbleHeight - gap;

    if (top < margin) {
      top = rect.bottom + gap;
    }

    bubble.style.left =
      Math.round(
        clamp(left, margin, window.innerWidth - bubbleWidth - margin),
      ) + "px";
    bubble.style.top =
      Math.round(
        clamp(top, margin, window.innerHeight - bubbleHeight - margin),
      ) + "px";
  }

  function showBubble(tip) {
    var text = tip.getAttribute("data-tip");
    if (!text) return;

    activeTip = tip;
    bubble.textContent = text;
    bubble.classList.add("visible");
    positionBubble();
  }

  function hideBubble() {
    activeTip = null;
    bubble.classList.remove("visible");
  }

  document.addEventListener("mouseover", function (event) {
    var tip = closestTip(event.target);
    if (tip) showBubble(tip);
  });

  document.addEventListener("mouseout", function (event) {
    if (!activeTip) return;
    var next = event.relatedTarget;
    if (!next || (next !== activeTip && !activeTip.contains(next))) {
      hideBubble();
    }
  });

  document.addEventListener("focusin", function (event) {
    var tip = closestTip(event.target);
    if (tip) showBubble(tip);
  });

  document.addEventListener("focusout", function (event) {
    if (activeTip && event.target === activeTip) {
      hideBubble();
    }
  });

  window.addEventListener("resize", positionBubble);
  window.addEventListener("scroll", positionBubble, true);
})();
