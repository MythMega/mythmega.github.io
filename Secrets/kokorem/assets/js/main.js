/* ============================================
   KOKORO PROJECT — Animate on Scroll + UI
   ============================================ */

(function () {
  'use strict';

  // ── Animate on Scroll (IntersectionObserver) ──
  const aosSel = '.aos, .aos-fade, .aos-left, .aos-right, .aos-scale';

  function initAOS() {
    const elements = document.querySelectorAll(aosSel);
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -60px 0px'
    });

    elements.forEach(el => observer.observe(el));
  }

  // ── Mobile Menu ──
  function initMobileMenu() {
    const hamburger = document.querySelector('.nav__hamburger');
    const mobileMenu = document.querySelector('.mobile-menu');
    const closeBtn = document.querySelector('.mobile-menu__close');

    if (!hamburger || !mobileMenu) return;

    hamburger.addEventListener('click', () => {
      mobileMenu.classList.add('open');
      document.body.style.overflow = 'hidden';
    });

    const close = () => {
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    };

    if (closeBtn) closeBtn.addEventListener('click', close);

    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', close);
    });
  }

  // ── Navbar scroll shrink ──
  function initNavScroll() {
    const nav = document.querySelector('.nav');
    if (!nav) return;

    const onScroll = () => {
      if (window.scrollY > 20) {
        nav.style.boxShadow = '0 1px 20px rgba(0,0,0,0.1)';
      } else {
        nav.style.boxShadow = 'none';
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── Subtle Parallax on hero ──
  function initParallax() {
    const hero = document.querySelector('.hero__img');
    if (!hero) return;

    const onScroll = () => {
      const y = window.scrollY;
      hero.style.transform = `translateY(${y * 0.3}px)`;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── Stagger children inside a parent ──
  function initStagger() {
    document.querySelectorAll('.stagger-children').forEach(parent => {
      const children = parent.children;
      Array.from(children).forEach((child, i) => {
        child.classList.add('aos');
        child.style.transitionDelay = `${i * 0.1}s`;
      });
    });
  }

  // ── Image hover depth on product cards ──
  function initCardHover() {
    document.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-4px)';
        card.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateY(0)';
      });
    });
  }

  // ── Marquee duplicate ──
  function initMarquee() {
    document.querySelectorAll('.marquee-track').forEach(track => {
      const clone = track.innerHTML;
      track.innerHTML = clone + clone; // duplicate content for seamless loop
    });
  }

  // ── Init all ──
  document.addEventListener('DOMContentLoaded', () => {
    initStagger();
    initAOS();
    initMobileMenu();
    initNavScroll();
    initParallax();
    initCardHover();
    initMarquee();
  });
})();
