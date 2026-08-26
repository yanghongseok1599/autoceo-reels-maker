'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? '초대코드를 확인해주세요.');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('접속에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="loginShell">
      <form className="loginCard" onSubmit={submit}>
        <h1>오토사장</h1>
        <p>수강생 초대코드를 입력해주세요.</p>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="초대코드"
          autoComplete="off"
          aria-label="초대코드"
        />
        <button type="submit" disabled={busy || !code.trim()}>
          {busy ? '확인 중…' : '시작하기'}
        </button>
        {error && <p className="loginError">{error}</p>}
      </form>
    </main>
  );
}
