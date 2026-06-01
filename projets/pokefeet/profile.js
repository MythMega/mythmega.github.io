// profile.js — Gestion du profil utilisateur (pseudo stocké en cookie)
const COOKIE_NAME = 'pk_pseudo';

function setCookie(name, value, days = 365) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
}
function getCookie(name) {
  const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return v ? decodeURIComponent(v.pop()) : null;
}
function eraseCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

function ProfileInit() {
  const pseudoInput  = document.getElementById('pseudoInput');
  const saveBtn      = document.getElementById('savePseudoBtn');
  const clearBtn     = document.getElementById('clearPseudoBtn');
  const statusEl     = document.getElementById('profileStatus');

  if (!pseudoInput || !saveBtn) return;

  const saved = getCookie(COOKIE_NAME);
  if (saved) pseudoInput.value = saved;

  saveBtn.addEventListener('click', () => {
    const val = pseudoInput.value.trim();
    if (!val) {
      statusEl.textContent = typeof Translator !== 'undefined' ? Translator.get('profile.emptyWarning', 'Veuillez entrer un pseudo') : 'Veuillez entrer un pseudo';
      statusEl.style.color = 'var(--accent)';
      return;
    }
    if (val.length > 30) {
      statusEl.textContent = typeof Translator !== 'undefined' ? Translator.get('profile.tooLong', 'Le pseudo ne doit pas dépasser 30 caractères') : 'Le pseudo ne doit pas dépasser 30 caractères';
      statusEl.style.color = '#f59e0b';
      return;
    }
    setCookie(COOKIE_NAME, val);
    statusEl.textContent = typeof Translator !== 'undefined' ? Translator.get('profile.saved', 'Pseudo sauvegardé !') : 'Pseudo sauvegardé !';
    statusEl.style.color = 'var(--accent)';
  });

  clearBtn.addEventListener('click', () => {
    eraseCookie(COOKIE_NAME);
    pseudoInput.value = '';
    statusEl.textContent = typeof Translator !== 'undefined' ? Translator.get('profile.cleared', 'Pseudo effacé') : 'Pseudo effacé';
    statusEl.style.color = 'var(--muted)';
  });

  pseudoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });
}

// Auto-init on standalone profile page
document.addEventListener('DOMContentLoaded', ProfileInit);
