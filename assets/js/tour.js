/* ============================================================
   ColorSLCT · tour.js — spotlight walkthrough
   A moving cutout + card that walks new people through the
   studio in plain words, ending on a quick preferences step.
   Keyboard: ← → advance, Esc skips. Reduced motion = no
   animated moves. Replayable from Help / Preferences.
   ============================================================ */
(function () {
  'use strict';

  function Tour(steps, opts) {
    this.steps = steps;
    this.opts = opts || {};
    this.i = 0;
    this.veil = null;
    this.hole = null;
    this.card = null;
    this._keyHandler = null;
    this._resizeHandler = null;
  }

  Tour.prototype.start = function () {
    if (this.veil) return;
    var self = this;
    this.veil = document.createElement('div');
    this.veil.className = 'tour-veil';
    this.veil.setAttribute('role', 'dialog');
    this.veil.setAttribute('aria-label', 'Welcome tour');

    this.hole = document.createElement('div');
    this.hole.className = 'tour-hole';
    this.card = document.createElement('div');
    this.card.className = 'tour-card';
    this.veil.appendChild(this.hole);
    this.veil.appendChild(this.card);
    document.body.appendChild(this.veil);

    this._keyHandler = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); self.finish(true); }
      if (e.key === 'ArrowRight') { e.preventDefault(); self.next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); self.prev(); }
    };
    this._resizeHandler = function () { self.position(); };
    document.addEventListener('keydown', this._keyHandler, true);
    window.addEventListener('resize', this._resizeHandler);
    window.addEventListener('scroll', this._resizeHandler, true);

    this.show(0);
  };

  Tour.prototype.target = function () {
    var sel = this.steps[this.i].target;
    return sel ? document.querySelector(sel) : null;
  };

  Tour.prototype.position = function () {
    if (!this.veil) return;
    var el = this.target();
    var pad = 8;
    var r;
    if (el) {
      r = el.getBoundingClientRect();
    } else {
      // centred "no target" spotlight
      r = { left: window.innerWidth / 2 - 30, top: window.innerHeight * 0.32, width: 60, height: 60 };
    }
    this.hole.style.left = (r.left - pad) + 'px';
    this.hole.style.top = (r.top - pad) + 'px';
    this.hole.style.width = (r.width + pad * 2) + 'px';
    this.hole.style.height = (r.height + pad * 2) + 'px';

    // card placement: below if room, else above, clamped to viewport
    var cw = Math.min(window.innerWidth * 0.92, 340);
    var ch = this.card.offsetHeight || 220;
    var top = r.top + r.height + pad * 2 + 10;
    if (top + ch > window.innerHeight - 12) top = Math.max(12, r.top - ch - pad * 2 - 10);
    var left = Math.min(Math.max(12, r.left), window.innerWidth - cw - 12);
    this.card.style.top = top + 'px';
    this.card.style.left = left + 'px';
  };

  Tour.prototype.show = function (idx) {
    this.i = Math.max(0, Math.min(this.steps.length - 1, idx));
    var step = this.steps[this.i];
    var el = this.target();
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'center', behavior: (window.CSLCT && CSLCT.prefersReducedMotion()) ? 'auto' : 'smooth' });
    }

    var dots = '';
    for (var d = 0; d < this.steps.length; d++) {
      dots += '<i class="' + (d === this.i ? 'on' : '') + '"></i>';
    }
    var last = this.i === this.steps.length - 1;
    this.card.innerHTML =
      '<div class="tour-step-label">Step ' + (this.i + 1) + ' of ' + this.steps.length + '</div>' +
      '<h3></h3><p></p>' +
      (step.custom ? '<div class="tour-prefs">' + step.custom + '</div>' : '') +
      '<div class="tour-dots">' + dots + '</div>' +
      '<div class="tour-nav">' +
      (this.i > 0 ? '<button type="button" class="btn btn-ghost" data-tour-prev>Back</button>' : '') +
      '<button type="button" class="btn btn-volt" data-tour-next>' + (last ? 'Finish' : 'Next') + '</button>' +
      (!last ? '<button type="button" class="tour-skip" data-tour-skip>Skip tour</button>' : '') +
      '</div>';
    this.card.querySelector('h3').textContent = step.title;
    this.card.querySelector('p').textContent = step.body;

    var self = this;
    var nextBtn = this.card.querySelector('[data-tour-next]');
    nextBtn.addEventListener('click', function () { self.next(); });
    var prevBtn = this.card.querySelector('[data-tour-prev]');
    if (prevBtn) prevBtn.addEventListener('click', function () { self.prev(); });
    var skipBtn = this.card.querySelector('[data-tour-skip]');
    if (skipBtn) skipBtn.addEventListener('click', function () { self.finish(true); });

    if (step.onShow) step.onShow(this.card);

    var reduced = window.CSLCT && CSLCT.prefersReducedMotion();
    if (reduced) {
      this.hole.style.transition = 'none';
      this.card.style.transition = 'none';
    }
    this.position();
    // re-position once card height is known
    var again = this.position.bind(this);
    requestAnimationFrame(again);
    setTimeout(nextBtn.focus.bind(nextBtn), reduced ? 0 : 480);
  };

  Tour.prototype.next = function () {
    if (this.i >= this.steps.length - 1) { this.finish(false); return; }
    this.show(this.i + 1);
  };
  Tour.prototype.prev = function () { if (this.i > 0) this.show(this.i - 1); };

  Tour.prototype.finish = function (skipped) {
    if (!this.veil) return;
    document.removeEventListener('keydown', this._keyHandler, true);
    window.removeEventListener('resize', this._resizeHandler);
    window.removeEventListener('scroll', this._resizeHandler, true);
    this.veil.remove();
    this.veil = null;
    if (this.opts.onDone) this.opts.onDone(skipped);
  };

  window.CSLCTTour = Tour;
})();
