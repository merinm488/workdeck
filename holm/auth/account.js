(async () => {
  const status = document.getElementById('accountStatus');
  const details = document.getElementById('accountDetails');
  const email = document.getElementById('accountEmail');
  const signIn = document.getElementById('accountSignIn');
  const signOut = document.getElementById('accountSignOut');
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to check your session.');
    const session = await response.json();
    if (!session.member) {
      status.textContent = 'Sign in using your email to create or open your Workdeck account.';
      signIn.href = session.loginURL;
      signIn.hidden = false;
      return;
    }
    if (!session.member.email) {
      status.textContent = 'This sign-in has no verified email. Please sign out and use an email address to continue.';
      signOut.addEventListener('click', () => logOut(session.logoutURL));
      details.hidden = false;
      email.textContent = session.member.name || 'Account without verified email';
      return;
    }
    status.textContent = 'Your account is ready.';
    email.textContent = session.member.email;
    details.hidden = false;
    signOut.addEventListener('click', () => logOut(session.logoutURL));
  } catch (_) {
    status.textContent = 'We could not check your account. Please refresh the page and try again.';
  }
  async function logOut(url) {
    signOut.disabled = true;
    try {
      const result = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!result.ok) throw new Error('Sign out failed.');
      location.assign('/');
    } catch (_) {
      signOut.disabled = false;
      status.textContent = 'Could not sign out. Please try again.';
    }
  }
})();
