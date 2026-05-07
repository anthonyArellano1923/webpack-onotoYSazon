import { useState } from 'react';
import { registerUser, loginUser, saveAuth } from '../services/api';
import { IconClose } from './Icons';

export default function AuthModal({ onClose, onSuccess }) {
  const [tab, setTab] = useState('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Campos de login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Campos de registro
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');

  function resetError() { setError(''); }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await loginUser({ email: loginEmail, password: loginPassword });
      saveAuth(data.accessToken, data.user);
      onSuccess(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await registerUser({ name: regName, email: regEmail, password: regPassword, phone: regPhone });
      // Login automático tras el registro
      const data = await loginUser({ email: regEmail, password: regPassword });
      saveAuth(data.accessToken, data.user);
      onSuccess(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        className="modal auth-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <div className="modal__handle" aria-hidden="true" />
        <button className="modal__close" onClick={onClose} aria-label="Cerrar">
          <IconClose />
        </button>

        {/* Tabs */}
        <div className="auth-modal__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'login'}
            className={`auth-modal__tab${tab === 'login' ? ' auth-modal__tab--active' : ''}`}
            onClick={() => { setTab('login'); resetError(); }}
          >
            Iniciar sesión
          </button>
          <button
            role="tab"
            aria-selected={tab === 'register'}
            className={`auth-modal__tab${tab === 'register' ? ' auth-modal__tab--active' : ''}`}
            onClick={() => { setTab('register'); resetError(); }}
          >
            Crear cuenta
          </button>
        </div>

        <div className="modal__body" style={{ paddingTop: 20 }}>
          <h2 id="auth-modal-title" className="modal__title">
            {tab === 'login'
              ? <>Bienvenido <span className="modal__title-em">de vuelta</span></>
              : <>Crea tu <span className="modal__title-em">cuenta</span></>}
          </h2>

          {tab === 'login' ? (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <AuthField label="Correo" id="login-email">
                <input
                  id="login-email"
                  className="form-input"
                  type="email"
                  autoComplete="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="tu@correo.com"
                />
              </AuthField>
              <AuthField label="Contraseña" id="login-pwd">
                <input
                  id="login-pwd"
                  className="form-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </AuthField>
              {error && <p className="auth-modal__error" role="alert">{error}</p>}
              <button type="submit" className="btn btn--primary modal__cta" disabled={loading}>
                {loading ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <AuthField label="Nombre" id="reg-name">
                <input
                  id="reg-name"
                  className="form-input"
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="¿Cómo te llamas?"
                />
              </AuthField>
              <AuthField label="Correo" id="reg-email">
                <input
                  id="reg-email"
                  className="form-input"
                  type="email"
                  autoComplete="email"
                  required
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="tu@correo.com"
                />
              </AuthField>
              <AuthField label="Teléfono (opcional)" id="reg-phone">
                <input
                  id="reg-phone"
                  className="form-input"
                  type="tel"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="+56 9 ..."
                />
              </AuthField>
              <AuthField label="Contraseña" id="reg-pwd">
                <input
                  id="reg-pwd"
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Mín. 8 caracteres, 1 mayúscula, 1 número"
                />
              </AuthField>
              {error && <p className="auth-modal__error" role="alert">{error}</p>}
              <button type="submit" className="btn btn--primary modal__cta" disabled={loading}>
                {loading ? 'Creando cuenta…' : 'Crear cuenta'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthField({ label, id, children }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontSize: 12, fontWeight: 600,
        letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--fg-subtle)',
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}
