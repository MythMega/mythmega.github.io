/**
 * nav.js — Futuristic site bootstrap for JMDV / MythMega
 * Injects: page loader, particle canvas, navbar, scroll effects, reveal animations
 */
(function () {
  'use strict';

  /* ──────────────────────────────────────
     PAGE LOADER
  ────────────────────────────────────── */
  const loader = document.createElement('div');
  loader.id = 'page-loader';
  loader.innerHTML = `
    <div class="loader-logo">JMDV</div>
    <div class="loader-bar"><div class="loader-bar-fill"></div></div>
    <div class="loader-text">Chargement…</div>
  `;
  document.body.insertAdjacentElement('afterbegin', loader);

  function hideLoader() {
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 600);
  }

  if (document.readyState === 'complete') {
    setTimeout(hideLoader, 200);
  } else {
    window.addEventListener('load', () => setTimeout(hideLoader, 200));
  }

  /* ──────────────────────────────────────
     PARTICLE CANVAS
  ────────────────────────────────────── */
  const canvas = document.createElement('canvas');
  canvas.id = 'particles-canvas';
  document.body.insertAdjacentElement('afterbegin', canvas);

  const ctx = canvas.getContext('2d');
  const PARTICLE_COUNT = 70;
  const CONNECTION_DIST = 130;
  let particles = [];

  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function makeParticle() {
    return {
      x:     Math.random() * canvas.width,
      y:     Math.random() * canvas.height,
      r:     Math.random() * 1.4 + 0.4,
      vx:    (Math.random() - 0.5) * 0.28,
      vy:    (Math.random() - 0.5) * 0.28,
      alpha: Math.random() * 0.45 + 0.08,
      color: Math.random() > 0.55 ? '0,212,255' : '123,47,255',
    };
  }

  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); particles = Array.from({ length: PARTICLE_COUNT }, makeParticle); });
  particles = Array.from({ length: PARTICLE_COUNT }, makeParticle);

  function tickParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width)  p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.fill();
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(0,212,255,${0.07 * (1 - dist / CONNECTION_DIST)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(tickParticles);
  }

  tickParticles();

  /* ──────────────────────────────────────
     NAVBAR GENERATION
  ────────────────────────────────────── */
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';

  function active(href) {
    const file = href.split('/').pop();
    return file === currentFile ? ' active-page' : '';
  }

  const navHTML = `
<nav class="navbar navbar-expand-lg navbar-dark" id="main-navbar">
  <div class="container-fluid px-3">
    <a class="navbar-brand" href="index.html">JMDV</a>
    <button class="navbar-toggler" type="button"
      data-bs-toggle="collapse" data-bs-target="#navbarNav"
      aria-controls="navbarNav" aria-expanded="false" aria-label="Navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarNav">
      <ul class="navbar-nav ms-auto">

        <li class="nav-item">
          <a class="nav-link${active('index.html')}" href="index.html">Accueil</a>
        </li>

        <!-- EN LIVE -->
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button"
             data-bs-toggle="dropdown" aria-expanded="false">En live</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="https://www.twitch.tv/mythmega" target="_blank" rel="noopener">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="margin-right:4px;opacity:.7"><path d="M6.354 5.5H4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V8.5a.5.5 0 0 0-1 0V12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h2.354a.5.5 0 0 0 0-1z"/><path d="M7.5.5a.5.5 0 0 0 0 1h4.793L5.146 8.646a.5.5 0 1 0 .708.708L13 2.207V7a.5.5 0 0 0 1 0V1a.5.5 0 0 0-.5-.5h-6z"/></svg>Twitch</a></li>
            <li><a class="dropdown-item" href="https://www.youtube.com/@MythMega-VOD/live/" target="_blank" rel="noopener">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="margin-right:4px;opacity:.7"><path d="M6.354 5.5H4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V8.5a.5.5 0 0 0-1 0V12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h2.354a.5.5 0 0 0 0-1z"/><path d="M7.5.5a.5.5 0 0 0 0 1h4.793L5.146 8.646a.5.5 0 1 0 .708.708L13 2.207V7a.5.5 0 0 0 1 0V1a.5.5 0 0 0-.5-.5h-6z"/></svg>Youtube Live</a></li>
            <li><a class="dropdown-item${active('twitch_integrated.html')}" href="twitch_integrated.html">Twitch (intégré)</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item${active('planning.html')}" href="planning.html">Planning</a></li>
            <li><a class="dropdown-item${active('config.html')}" href="config.html">Config PC</a></li>
            <li><a class="dropdown-item${active('peak.html')}" href="peak.html">Peak &amp; Records</a></li>
            <li><a class="dropdown-item${active('giveaway.html')}" href="giveaway.html">Giveaway</a></li>
            <li><a class="dropdown-item" href="./pokedexLive/main.html">Pokédex Live</a></li>
          </ul>
        </li>

        <!-- MINECRAFT -->
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button"
             data-bs-toggle="dropdown" aria-expanded="false">Minecraft</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="https://www.planetminecraft.com/member/mythmega/submissions/projects/" target="_blank" rel="noopener">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="margin-right:4px;opacity:.7"><path d="M6.354 5.5H4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V8.5a.5.5 0 0 0-1 0V12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h2.354a.5.5 0 0 0 0-1z"/><path d="M7.5.5a.5.5 0 0 0 0 1h4.793L5.146 8.646a.5.5 0 1 0 .708.708L13 2.207V7a.5.5 0 0 0 1 0V1a.5.5 0 0 0-.5-.5h-6z"/></svg>Maps PMC</a></li>
            <li><a class="dropdown-item" href="https://www.planetminecraft.com/member/mythmega/submissions/data-packs/" target="_blank" rel="noopener">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="margin-right:4px;opacity:.7"><path d="M6.354 5.5H4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V8.5a.5.5 0 0 0-1 0V12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h2.354a.5.5 0 0 0 0-1z"/><path d="M7.5.5a.5.5 0 0 0 0 1h4.793L5.146 8.646a.5.5 0 1 0 .708.708L13 2.207V7a.5.5 0 0 0 1 0V1a.5.5 0 0 0-.5-.5h-6z"/></svg>Datapacks PMC</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item${active('mc_javarock.html')}" href="mc_javarock.html">Serveur JavaRock</a></li>
            <li><a class="dropdown-item${active('mc_buildit.html')}" href="mc_buildit.html">Serveur Build It</a></li>
            <li><a class="dropdown-item${active('mc_hyperlapse.html')}" href="mc_hyperlapse.html">Hyperlapses</a></li>
          </ul>
        </li>

        <!-- LOGICIELS -->
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button"
             data-bs-toggle="dropdown" aria-expanded="false">Logiciels</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item${active('soft_MCCare.html')}" href="soft_MCCare.html">Suite MinecraftCare</a></li>
            <li><a class="dropdown-item${active('soft_AutoVodMaker.html')}" href="soft_AutoVodMaker.html">AutoVODMaker</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="https://github.com/MythMega/" target="_blank" rel="noopener">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="margin-right:4px;opacity:.7"><path d="M6.354 5.5H4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V8.5a.5.5 0 0 0-1 0V12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h2.354a.5.5 0 0 0 0-1z"/><path d="M7.5.5a.5.5 0 0 0 0 1h4.793L5.146 8.646a.5.5 0 1 0 .708.708L13 2.207V7a.5.5 0 0 0 1 0V1a.5.5 0 0 0-.5-.5h-6z"/></svg>Github</a></li>
            <li><a class="dropdown-item${active('cv.html')}" href="cv.html">CV</a></li>
            <li><a class="dropdown-item${active('porfolio.html')}" href="porfolio.html">Portfolio</a></li>
          </ul>
        </li>

        <!-- MUSIQUES -->
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button"
             data-bs-toggle="dropdown" aria-expanded="false">Musiques</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="https://music.youtube.com/playlist?list=OLAK5uy_kR3lTx6WyYRMPXns1EZAxs1nXLKTXMJnc" target="_blank" rel="noopener">Journey No Destinations</a></li>
            <li><a class="dropdown-item" href="https://music.youtube.com/playlist?list=OLAK5uy_mvzBxia7UzxeHokmEQYUVO1kLvuUEU_uI" target="_blank" rel="noopener">Pile ou Face</a></li>
            <li><a class="dropdown-item" href="https://music.youtube.com/playlist?list=OLAK5uy_mhnqdcrLNM7KA55dX_mH23k4hffxwWm78" target="_blank" rel="noopener">Under The Wave</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="https://open.spotify.com/intl-fr/artist/5oGXhBpWfuYZ5wQ6iRFZsp" target="_blank" rel="noopener">Spotify</a></li>
            <li><a class="dropdown-item" href="https://music.youtube.com/channel/UC1t79TP9wTVFP8ph3hOpuuQ" target="_blank" rel="noopener">Youtube Musique</a></li>
            <li><a class="dropdown-item" href="https://music.apple.com/fr/artist/mythmega/1649554649" target="_blank" rel="noopener">Apple Musique</a></li>
            <li><a class="dropdown-item${active('music_platforms.html')}" href="music_platforms.html">Autres plateformes</a></li>
          </ul>
        </li>

        <!-- RÉSEAUX -->
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button"
             data-bs-toggle="dropdown" aria-expanded="false">Réseaux</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item${active('social_youtube.html')}" href="social_youtube.html">Youtube</a></li>
            <li><a class="dropdown-item${active('social_discord.html')}" href="social_discord.html">Discord</a></li>
            <li><a class="dropdown-item${active('social_bluesky.html')}" href="social_bluesky.html">Bluesky</a></li>
            <li><a class="dropdown-item${active('social_instagram.html')}" href="social_instagram.html">Instagram</a></li>
          </ul>
        </li>

        <!-- BLOG / PHOTOS -->
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button"
             data-bs-toggle="dropdown" aria-expanded="false">Blog / Photos</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item disabled" href="#" tabindex="-1" aria-disabled="true"
                   style="opacity:.45;cursor:default;">Bientôt disponible…</a></li>
          </ul>
        </li>

      </ul>
    </div>
  </div>
</nav>`;

  document.body.insertAdjacentHTML('afterbegin', navHTML);

  /* ──────────────────────────────────────
     NAVBAR SCROLL EFFECT
  ────────────────────────────────────── */
  const navbar = document.getElementById('main-navbar');
  if (navbar) {
    window.addEventListener('scroll', function () {
      navbar.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  /* ──────────────────────────────────────
     REVEAL ON SCROLL
  ────────────────────────────────────── */
  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(el => obs.observe(el));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReveal);
  } else {
    initReveal();
  }

})();
