const menuBtn = document.querySelector('.menu-btn');
const navLinks = document.getElementById('nav-links');

if (menuBtn && navLinks) {
  function openMenu() {
    navLinks.classList.add('open');
    menuBtn.innerHTML = '&#10005;';
    menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    navLinks.classList.remove('open');
    menuBtn.innerHTML = '&#9776;';
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  menuBtn.addEventListener('click', () => {
    if (navLinks.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close after picking a link, so the menu doesn't linger open on the
  // next page.
  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (ev) => {
    if (
      navLinks.classList.contains('open') &&
      !navLinks.contains(ev.target) &&
      !menuBtn.contains(ev.target)
    ) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeMenu();
  });
}
