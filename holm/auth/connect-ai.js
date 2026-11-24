// Holm manages MCP OAuth, consent and revocation at its own reserved paths;
// Workdeck never handles OAuth tokens or calls the legacy connection API.
(() => {
  const $ = id => document.getElementById(id);
  document.addEventListener('DOMContentLoaded', () => {
    const modal = $('connectAIModal');
    const select = $('connectAIClient');
    if (!modal || !select || !$('connectAIBtn')) return;
    const close = () => modal.classList.remove('active');
    const update = () => {
      $('connectAIInstructions').querySelectorAll('[data-client]').forEach(node => {
        node.hidden = node.dataset.client !== select.value;
      });
    };
    $('connectAIBtn').addEventListener('click', () => {
      $('connectAIUrl').textContent = location.origin + '/_holm/mcp';
      update();
      modal.classList.add('active');
    });
    select.addEventListener('change', update);
    $('connectAIClose').addEventListener('click', close);
    $('connectAICloseBtn').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    $('connectAICopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('connectAIUrl').textContent);
        $('connectAICopy').textContent = 'Copied!';
        setTimeout(() => { $('connectAICopy').textContent = 'Copy'; }, 2000);
      } catch (_) { window.alert('Copy failed. Select the URL and copy it manually.'); }
    });
  });
})();
