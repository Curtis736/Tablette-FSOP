(function () {
  const links = document.querySelectorAll('.sidebar nav a[href^="#"]');
  const sections = [...links].map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);

  function setActive() {
    let current = sections[0]?.id;
    const y = window.scrollY + 80;
    for (const sec of sections) {
      if (sec.offsetTop <= y) current = sec.id;
    }
    links.forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }

  window.addEventListener('scroll', setActive, { passive: true });
  setActive();

  const toggle = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    links.forEach((a) => a.addEventListener('click', () => sidebar.classList.remove('open')));
  }
})();
