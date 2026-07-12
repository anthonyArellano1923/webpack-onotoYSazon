import { useState } from 'react';
import { registerUser, loginUser, saveAuth } from '../services/api';
import { normalizePhone, phoneToDigits } from '../utils/phone';
import { IconClose } from './Icons';

/**
 * Autenticación por TELÉFONO (decisión del dueño: sus clientes viven en
 * WhatsApp, no en el correo). El registro pide nombre, teléfono y contraseña;
 * la dirección es opcional y sirve para prellenar el despacho del carrito.
 */
export default function AuthModal({ onClose, onSuccess }) {
  const [tab, setTab] = useState('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Campos de login
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Campos de registro
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regAddress, setRegAddress] = useState('');
  const [regPassword, setRegPassword] = useState('');

  function resetError() { setError(''); }

  const loginPhoneValid = normalizePhone(loginPhone) !== null;
  const regPhoneValid = normalizePhone(regPhone) !== null;

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await loginUser({ phone: loginPhone, password: loginPassword });
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
      await registerUser({ name: regName, phone: regPhone, password: regPassword, address: regAddress || undefined });
      // Login automático tras el registro
      const data = await loginUser({ phone: regPhone, password: regPassword });
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
              <AuthField label="Teléfono" id="login-phone">
                <PhoneInput
                  id="login-phone"
                  value={loginPhone}
                  onChange={setLoginPhone}
                  autoComplete="tel-national"
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
              <button type="submit" className="btn btn--primary modal__cta"
                disabled={loading || !loginPhoneValid}
                style={{ opacity: (loading || !loginPhoneValid) ? 0.6 : 1 }}>
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
              <AuthField label="Teléfono" id="reg-phone">
                <PhoneInput
                  id="reg-phone"
                  value={regPhone}
                  onChange={setRegPhone}
                  autoComplete="tel-national"
                />
                {regPhone.length === 9 && !regPhoneValid &&
                <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--onoto-crimson, #880D1E)' }}>
                    Número inválido: los celulares chilenos empiezan con 9 (ej. 912345678).
                  </p>
                }
              </AuthField>
              <AuthField label="Dirección (opcional)" id="reg-address">
                <input
                  id="reg-address"
                  className="form-input"
                  type="text"
                  value={regAddress}
                  onChange={(e) => setRegAddress(e.target.value)}
                  placeholder="Calle 123, Comuna (para despachos)"
                  maxLength={200}
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
              <button type="submit" className="btn btn--primary modal__cta"
                disabled={loading || !regPhoneValid}
                style={{ opacity: (loading || !regPhoneValid) ? 0.6 : 1 }}>
                {loading ? 'Creando cuenta…' : 'Crear cuenta'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/** Input de teléfono con addon +56: el usuario escribe solo los 9 dígitos. */
function PhoneInput({ id, value, onChange, autoComplete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 14, color: 'var(--fg-muted)' }}>+56</span>
      <input
        id={id}
        className="form-input"
        type="tel"
        inputMode="numeric"
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(e) => onChange(phoneToDigits(e.target.value).slice(0, 9))}
        placeholder="9 dígitos"
        maxLength={9}
        style={{ flex: 1 }}
      />
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
