document.getElementById('btn-login').addEventListener('click', () => {
  window.claude.openLogin();
});
document.getElementById('btn-close').addEventListener('click', () => {
  window.claude.hideWidget();
});
