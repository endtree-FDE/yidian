const installButtons = [...document.querySelectorAll('[data-install-app]')];
const installHelp = document.querySelector('[data-install-help]');
let installPrompt;

addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButtons.forEach((button) => { button.hidden = false; });
});

for (const button of installButtons) {
  button.addEventListener('click', async () => {
    if (!installPrompt) {
      if (installHelp) installHelp.hidden = false;
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = undefined;
    installButtons.forEach((item) => { item.hidden = true; });
  });
}

addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installButtons.forEach((button) => { button.hidden = true; });
  if (installHelp) installHelp.hidden = true;
});

function offerUpdate(registration) {
  if (!registration.waiting || document.querySelector('.pwa-update')) return;
  const notice = document.createElement('aside');
  notice.className = 'pwa-update';
  notice.setAttribute('role', 'status');
  notice.innerHTML = '<span><strong>一点长大了一点</strong><small>新版本已经准备好。</small></span><button type="button">现在更新</button>';
  notice.querySelector('button').addEventListener('click', () => registration.waiting?.postMessage('SKIP_WAITING'));
  document.body.append(notice);
}

if ('serviceWorker' in navigator) {
  addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js');
      offerUpdate(registration);
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', () => offerUpdate(registration));
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    } catch {
      // 官网仍可正常使用；稍后再次打开时会重新尝试注册。
    }
  });
}
