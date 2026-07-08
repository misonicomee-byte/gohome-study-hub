(function () {
  var endpoint = "/api/analytics/event";
  var visitorId = getStoredId("localStorage", "gohome-study-visitor-id");
  var sessionId = getStoredId("sessionStorage", "gohome-study-session-id");

  function getStoredId(storageName, key) {
    try {
      var storage = window[storageName];
      var existing = storage.getItem(key);
      if (existing) return existing;
      var next = createId();
      storage.setItem(key, next);
      return next;
    } catch (_error) {
      return createId();
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength || 220);
  }

  function send(eventName, payload) {
    var body = JSON.stringify(Object.assign({
      event_name: eventName,
      page_path: window.location.pathname + window.location.search,
      visitor_id: visitorId,
      session_id: sessionId
    }, payload || {}));

    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
      credentials: "same-origin"
    }).catch(function () {});
  }

  function closestDataNode(target) {
    if (!(target instanceof Element)) return null;
    return target.closest("[data-content-type], [data-content-id], [data-module-card], [data-module-id]");
  }

  function datasetValue(target, key) {
    var direct = target instanceof HTMLElement ? target.dataset[key] : "";
    if (direct) return direct;
    var node = closestDataNode(target);
    return node instanceof HTMLElement ? node.dataset[key] || "" : "";
  }

  function inferTypeFromUrl(url) {
    try {
      var parsed = new URL(url, window.location.href);
      if (parsed.pathname.indexOf("/lectures/") === 0) return "lecture";
      if (parsed.pathname.indexOf("/houtei-kenshu") === 0) return "houtei_kenshu";
      if (parsed.pathname.indexOf("/line") === 0) return "line";
      if (parsed.hostname.indexOf("docs.google.com") >= 0) return "resume";
      if (parsed.hostname.indexOf("instagram.com") >= 0) return "instagram";
      if (parsed.hostname.indexOf("youtube.com") >= 0 || parsed.hostname.indexOf("youtu.be") >= 0) return "youtube";
      if (parsed.hostname === "gohome-clinic.com" && parsed.pathname.indexOf("/recruit") === 0) return "recruit_site";
      if (parsed.hostname === "gohome-clinic.com" && parsed.pathname.indexOf("/blog") >= 0) return "clinic_blog";
      if (parsed.hostname === "gohome-clinic.com") return "clinic_site";
      return parsed.origin === window.location.origin ? "internal" : "external";
    } catch (_error) {
      return "unknown";
    }
  }

  function inferIdFromUrl(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin
        ? parsed.pathname.replace(/\/$/, "") || "/"
        : parsed.href.split("#")[0];
    } catch (_error) {
      return cleanText(url, 220);
    }
  }

  function titleFrom(target) {
    var explicit = datasetValue(target, "contentTitle");
    if (explicit) return explicit;
    var moduleTitle = "";
    var moduleCard = target instanceof Element ? target.closest("[data-module-card]") : null;
    if (moduleCard) {
      moduleTitle = cleanText(moduleCard.querySelector("h2")?.textContent || "", 220);
    }
    if (moduleTitle) return moduleTitle;
    return cleanText(target.textContent || target.getAttribute("aria-label") || "", 220);
  }

  function trackResumeClick(target) {
    var url = target.dataset.resumeUrl || "";
    if (!url) return;
    send("content_click", {
      content_type: "resume",
      content_id: datasetValue(target, "contentId") || inferIdFromUrl(url),
      content_title: titleFrom(target),
      destination_url: url
    });
  }

  function trackElementClick(target) {
    if (!(target instanceof HTMLElement)) return;

    var eventName = "content_click";
    var contentType = target.dataset.contentType || datasetValue(target, "contentType");
    var contentId = target.dataset.contentId || datasetValue(target, "contentId");
    var destinationUrl = "";

    if (target.dataset.themeFilter) {
      contentType = "theme_filter";
      contentId = target.dataset.themeFilter;
    } else if (target.dataset.gradeQuiz !== undefined) {
      eventName = "quiz_grade";
      contentType = "legal_training_video";
      contentId = target.dataset.moduleId || datasetValue(target, "moduleId");
    } else if (target.dataset.completeModule !== undefined) {
      eventName = "module_complete";
      contentType = "legal_training_video";
      contentId = target.dataset.moduleId || datasetValue(target, "moduleId");
    } else if (target.dataset.createCertificate !== undefined) {
      eventName = "certificate_create";
      contentType = "legal_training_video";
      contentId = target.dataset.moduleId || datasetValue(target, "moduleId");
    } else if (target instanceof HTMLAnchorElement) {
      destinationUrl = target.href;
      contentType = contentType || inferTypeFromUrl(destinationUrl);
      contentId = contentId || inferIdFromUrl(destinationUrl);
    }

    send(eventName, {
      content_type: contentType || "interaction",
      content_id: contentId || cleanText(target.getAttribute("href") || target.dataset.moduleId || titleFrom(target), 220),
      content_title: titleFrom(target),
      destination_url: destinationUrl || null
    });
  }

  document.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    var resumeTarget = event.target.closest("[data-resume-url]");
    if (resumeTarget instanceof HTMLElement) {
      trackResumeClick(resumeTarget);
      return;
    }

    var target = event.target.closest("a, button[data-theme-filter], button[data-grade-quiz], button[data-complete-module], button[data-create-certificate]");
    if (target instanceof HTMLElement) trackElementClick(target);
  }, true);

  function initVideoTracking() {
    document.querySelectorAll("video[data-module-video]").forEach(function (video) {
      var milestones = { 25: false, 50: false, 75: false, 95: false };
      var played = false;

      function payload(progress) {
        var moduleId = video.dataset.moduleId || datasetValue(video, "moduleId");
        return {
          content_type: "legal_training_video",
          content_id: moduleId || "unknown",
          content_title: titleFrom(video),
          video_current_time: Math.floor(video.currentTime || 0),
          video_duration: Number.isFinite(video.duration) ? Math.floor(video.duration) : null,
          video_progress: progress
        };
      }

      video.addEventListener("play", function () {
        if (played) return;
        played = true;
        send("video_play", payload(0));
      });

      video.addEventListener("pause", function () {
        if (video.ended || (video.currentTime || 0) < 5) return;
        var duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        var progress = duration ? Math.floor((video.currentTime / duration) * 100) : null;
        send("video_pause", payload(progress));
      });

      video.addEventListener("timeupdate", function () {
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        var progress = Math.floor((video.currentTime / video.duration) * 100);
        [25, 50, 75, 95].forEach(function (milestone) {
          if (!milestones[milestone] && progress >= milestone) {
            milestones[milestone] = true;
            send("video_progress", payload(milestone));
          }
        });
      });

      video.addEventListener("ended", function () {
        send("video_complete", payload(100));
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVideoTracking);
  } else {
    initVideoTracking();
  }
})();
